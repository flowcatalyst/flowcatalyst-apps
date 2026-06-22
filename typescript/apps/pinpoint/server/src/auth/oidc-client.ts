/**
 * Minimal OIDC authorization-code-with-PKCE client — a plain `fetch`
 * implementation that matches the FlowCatalyst platform's hand-rolled OAuth
 * server exactly (the same body-POST form the SDK's `flowcatalystAuth` uses).
 *
 * We deliberately do NOT use openid-client here: it's a strict, spec-compliant
 * library, and the FC platform's token endpoint is a minimal custom
 * implementation whose `client_secret_basic` handling isn't RFC-6749-§2.3.1
 * compliant (it doesn't URL-decode Basic credentials). openid-client's Basic
 * auth therefore failed against it; the platform's body-POST path works. This
 * client sends `client_id` + `client_secret` as form fields in the token
 * request body — the path the platform actually implements correctly.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { OidcConfig } from './auth-config.js';

export interface OidcTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string | null;
  readonly expiresAt: number | null;
}

export interface OidcUserInfo {
  readonly sub: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly raw: Record<string, unknown>;
}

export interface OidcAuthorizeParams {
  readonly url: URL;
  readonly state: string;
  readonly codeVerifier: string;
}

export interface OidcClient {
  buildAuthorizeUrl(): Promise<OidcAuthorizeParams>;
  exchangeCode(currentUrl: URL, codeVerifier: string, state: string): Promise<OidcTokens>;
  refresh(refreshToken: string): Promise<OidcTokens>;
  fetchUserInfo(accessToken: string, sub: string | null): Promise<OidcUserInfo>;
}

interface DiscoveryDoc {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint: string;
}

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

function toTokens(body: TokenResponseBody): OidcTokens {
  return {
    accessToken: body.access_token ?? '',
    refreshToken: body.refresh_token ?? null,
    idToken: body.id_token ?? null,
    expiresAt:
      typeof body.expires_in === 'number' ? Math.floor(Date.now() / 1000) + body.expires_in : null,
  };
}

/**
 * POST to the token endpoint with a form body. On a non-2xx, throws an Error
 * carrying `.error` / `.error_description` from the OAuth error body so the
 * callback route can surface the real cause.
 */
async function tokenRequest(
  tokenEndpoint: string,
  params: Record<string, string>,
): Promise<OidcTokens> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params),
  });

  if (!res.ok) {
    let oauthError: string | undefined;
    let oauthDescription: string | undefined;
    let detail = '';
    try {
      const errBody = (await res.json()) as { error?: string; error_description?: string };
      oauthError = errBody.error;
      oauthDescription = errBody.error_description;
      detail = [errBody.error, errBody.error_description].filter(Boolean).join(': ');
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 200);
    }
    const err = new Error(
      `OIDC token request failed (${res.status})${detail ? ` — ${detail}` : ''}`,
    ) as Error & { error?: string; error_description?: string };
    if (oauthError) err.error = oauthError;
    if (oauthDescription) err.error_description = oauthDescription;
    throw err;
  }

  const body = (await res.json()) as TokenResponseBody;
  if (!body.access_token) {
    throw new Error('OIDC token response missing access_token');
  }
  return toTokens(body);
}

/**
 * Initialise the OIDC client by fetching the issuer's discovery document.
 * Returns the four operations pinpoint's auth routes use. Throws (rejects)
 * on discovery failure — callers treat that as a startup failure.
 */
export async function createOidcClient(config: OidcConfig): Promise<OidcClient> {
  const wellKnown = `${config.issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(wellKnown, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${wellKnown}`);
  }
  const meta = (await res.json()) as DiscoveryDoc;

  const clientSecret = config.clientSecret ?? '';

  return {
    async buildAuthorizeUrl(): Promise<OidcAuthorizeParams> {
      const codeVerifier = b64url(randomBytes(32));
      const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
      const state = b64url(randomBytes(16));

      const url = new URL(meta.authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: config.scopes,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();

      return { url, state, codeVerifier };
    },

    async exchangeCode(currentUrl: URL, codeVerifier: string): Promise<OidcTokens> {
      const code = currentUrl.searchParams.get('code');
      if (!code) {
        throw new Error('callback URL is missing the authorization code');
      }
      return tokenRequest(meta.token_endpoint, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        code_verifier: codeVerifier,
      });
    },

    async refresh(refreshToken: string): Promise<OidcTokens> {
      return tokenRequest(meta.token_endpoint, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      });
    },

    async fetchUserInfo(accessToken: string, sub: string | null): Promise<OidcUserInfo> {
      const uiRes = await fetch(meta.userinfo_endpoint, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
      if (!uiRes.ok) {
        throw new Error(`userinfo request failed: ${uiRes.status}`);
      }
      const claims = (await uiRes.json()) as Record<string, unknown>;
      const name = typeof claims['name'] === 'string' ? claims['name'] : null;
      const email = typeof claims['email'] === 'string' ? claims['email'] : null;
      const resolvedSub = typeof claims['sub'] === 'string' ? claims['sub'] : (sub ?? '');
      return { sub: resolvedSub, name, email, raw: claims };
    },
  };
}
