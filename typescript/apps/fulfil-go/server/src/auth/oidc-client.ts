/**
 * Minimal OIDC authorization-code-with-PKCE broker — a plain `fetch`
 * implementation that matches the FlowCatalyst platform's hand-rolled OAuth
 * server exactly (adapted from pinpoint's client; see the header comment
 * there for why openid-client is deliberately NOT used: the platform's
 * `client_secret_basic` handling isn't RFC-6749-§2.3.1 compliant, so
 * credentials go as form fields in the token request body).
 *
 * fulfil-go differences vs pinpoint:
 * - the MOBILE APP generates the PKCE verifier + challenge and keeps the
 *   verifier on-device; the server only brokers — no cookies, no session.
 * - ONE OAuth client per app (execution / picking / management): requests
 *   name their app and `resolve(app)` binds the matching credentials.
 */
import type { FulfilGoApp, OidcClientConfig, OidcConfig } from './auth-config.js';

export interface OidcTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string | null;
  /** Epoch SECONDS at which the access token expires; null when unknown. */
  readonly expiresAt: number | null;
}

export interface BuildAuthorizeUrlParams {
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly state: string;
}

export interface ExchangeCodeParams {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

/** Broker operations bound to one app's OAuth client credentials. */
export interface ResolvedOidcClient {
  readonly app: FulfilGoApp | 'default';
  readonly allowedRedirectUris: readonly string[];
  buildAuthorizeUrl(params: BuildAuthorizeUrlParams): URL;
  exchangeCode(params: ExchangeCodeParams): Promise<OidcTokens>;
  refresh(refreshToken: string): Promise<OidcTokens>;
}

export interface MobileOidcBroker {
  /**
   * Bind operations to the named app's OAuth client. No app names the
   * `default` client (single-client dev setups). Returns null when the
   * requested client isn't configured.
   */
  resolve(app?: string): ResolvedOidcClient | null;
}

interface DiscoveryDoc {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
}

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

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
 * route can surface the real cause.
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
 * Initialise the broker by fetching the issuer's discovery document (once —
 * every app client shares the endpoints). Throws (rejects) on discovery
 * failure — callers treat that as a startup failure.
 */
export async function createMobileOidcBroker(config: OidcConfig): Promise<MobileOidcBroker> {
  const wellKnown = `${config.issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(wellKnown, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${wellKnown}`);
  }
  const meta = (await res.json()) as DiscoveryDoc;

  function bind(app: FulfilGoApp | 'default', client: OidcClientConfig): ResolvedOidcClient {
    const clientSecret = client.clientSecret ?? '';
    return {
      app,
      allowedRedirectUris: client.allowedRedirectUris,

      buildAuthorizeUrl({ codeChallenge, redirectUri, state }): URL {
        const url = new URL(meta.authorization_endpoint);
        url.search = new URLSearchParams({
          response_type: 'code',
          client_id: client.clientId,
          redirect_uri: redirectUri,
          scope: config.scopes,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        }).toString();
        return url;
      },

      async exchangeCode({ code, codeVerifier, redirectUri }): Promise<OidcTokens> {
        return tokenRequest(meta.token_endpoint, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: client.clientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          code_verifier: codeVerifier,
        });
      },

      async refresh(refreshToken: string): Promise<OidcTokens> {
        return tokenRequest(meta.token_endpoint, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: client.clientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
        });
      },
    };
  }

  return {
    resolve(app?: string): ResolvedOidcClient | null {
      const key = (app && app.length > 0 ? app : 'default') as FulfilGoApp | 'default';
      // Fall back to the shared 'default' client when the named app has no
      // dedicated one — the single-client local-dev setup. Its redirect
      // allowlist defaults to every app's URIs for exactly this reason.
      const client =
        config.clients[key] ?? (key === 'default' ? undefined : config.clients['default']);
      if (!client) return null;
      return bind(client === config.clients[key] ? key : 'default', client);
    },
  };
}
