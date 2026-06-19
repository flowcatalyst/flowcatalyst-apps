/**
 * Thin wrapper around openid-client v6 — pinpoint only needs the
 * authorization-code-with-PKCE flow + token refresh + userinfo. Keeps the
 * call sites in our auth routes free of openid-client's discovery /
 * Configuration plumbing.
 */
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  Configuration,
  discovery,
  fetchUserInfo,
  None,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
  skipSubjectCheck,
} from 'openid-client';
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

function toTokens(response: {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}): OidcTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    idToken: response.id_token ?? null,
    expiresAt:
      typeof response.expires_in === 'number'
        ? Math.floor(Date.now() / 1000) + response.expires_in
        : null,
  };
}

/**
 * Initialise the OIDC client by discovering the issuer's metadata. Returns
 * a thin object with the four operations we actually use. Throws (rejects)
 * if discovery fails — callers should treat that as a startup failure.
 */
export async function createOidcClient(config: OidcConfig): Promise<OidcClient> {
  // Client authentication method: public client when no secret (PKCE-only),
  // client_secret_basic when one is configured. Matches what most IdPs ship.
  const clientAuth = config.clientSecret !== null ? ClientSecretBasic(config.clientSecret) : None();

  // Allow plaintext HTTP only when explicitly opted in (test rigs
  // against an in-process fake IdP). openid-client v6 refuses
  // non-HTTPS by default — that's the production-safe behaviour.
  // The opt-in must be applied via `execute` on the discovery call
  // itself, because discovery is the first HTTP request and the flag
  // has no effect retroactively.
  const discovered: Configuration = await discovery(
    new URL(config.issuerUrl),
    config.clientId,
    {},
    clientAuth,
    config.allowInsecureRequests ? { execute: [allowInsecureRequests] } : undefined,
  );

  return {
    async buildAuthorizeUrl(): Promise<OidcAuthorizeParams> {
      const codeVerifier = randomPKCECodeVerifier();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
      const state = randomState();

      const url = buildAuthorizationUrl(discovered, {
        redirect_uri: config.redirectUri,
        scope: config.scopes,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      });

      return { url, state, codeVerifier };
    },

    async exchangeCode(currentUrl: URL, codeVerifier: string, state: string): Promise<OidcTokens> {
      const response = await authorizationCodeGrant(discovered, currentUrl, {
        expectedState: state,
        pkceCodeVerifier: codeVerifier,
      });
      return toTokens(response);
    },

    async refresh(refreshToken: string): Promise<OidcTokens> {
      const response = await refreshTokenGrant(discovered, refreshToken);
      return toTokens(response);
    },

    async fetchUserInfo(accessToken: string, sub: string | null): Promise<OidcUserInfo> {
      const response = await fetchUserInfo(
        discovered,
        accessToken,
        sub === null ? skipSubjectCheck : sub,
      );
      // openid-client returns OIDC UserInfoResponse which has known string
      // fields + arbitrary additional claims. Narrow the ones we care about.
      const claims = response as unknown as Record<string, unknown>;
      const name = typeof claims['name'] === 'string' ? (claims['name'] as string) : null;
      const email = typeof claims['email'] === 'string' ? (claims['email'] as string) : null;
      const resolvedSub =
        typeof claims['sub'] === 'string' ? (claims['sub'] as string) : (sub ?? '');
      return { sub: resolvedSub, name, email, raw: claims };
    },
  };
}
