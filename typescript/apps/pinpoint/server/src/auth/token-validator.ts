/**
 * JWT validator — mirrors the Rust SDK's `TokenValidator`. Fetches the
 * issuer's JWKS, verifies the JWT signature + claims (iss, aud, exp), and
 * exposes the canonical claim shape we care about.
 *
 * jose's `createRemoteJWKSet` does the JWKS fetch + cache for us (default
 * cache TTL is the JWKS response's `Cache-Control` header, with a minimum
 * we configure via cooldownDuration).
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { OidcConfig } from './auth-config.js';

export interface ValidatedToken {
  readonly sub: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly roles: readonly string[];
  readonly raw: JWTPayload;
}

export interface TokenValidator {
  validate(token: string): Promise<ValidatedToken>;
}

const JWKS_COOLDOWN_MS = 30_000;
const JWKS_REFRESH_MS = 60_000;
const JWKS_TIMEOUT_MS = 5_000;

/**
 * Build a validator backed by the issuer's published JWKS endpoint. The
 * JWKS URI is resolved from `${issuerUrl}/.well-known/openid-configuration`
 * lazily on first verify so startup doesn't require the IdP to be live.
 */
export function createTokenValidator(config: OidcConfig): TokenValidator {
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  let initPromise: Promise<void> | null = null;

  async function init(): Promise<void> {
    const discoveryUrl = new URL(
      '.well-known/openid-configuration',
      ensureTrailingSlash(config.issuerUrl),
    );
    const response = await fetch(discoveryUrl);
    if (!response.ok) {
      throw new Error(
        `OIDC discovery failed at ${discoveryUrl.toString()}: ${response.status} ${response.statusText}`,
      );
    }
    const doc = (await response.json()) as { jwks_uri?: string };
    if (!doc.jwks_uri) {
      throw new Error(`OIDC discovery document missing jwks_uri (issuer ${config.issuerUrl}).`);
    }
    jwks = createRemoteJWKSet(new URL(doc.jwks_uri), {
      cooldownDuration: JWKS_COOLDOWN_MS,
      cacheMaxAge: JWKS_REFRESH_MS,
      timeoutDuration: JWKS_TIMEOUT_MS,
    });
  }

  function getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (jwks) return Promise.resolve(jwks);
    if (!initPromise) {
      initPromise = init().catch((err) => {
        initPromise = null; // allow retry on next request
        throw err;
      });
    }
    return initPromise.then(() => {
      if (!jwks) throw new Error('JWKS not initialised after discovery.');
      return jwks;
    });
  }

  return {
    async validate(token: string): Promise<ValidatedToken> {
      const keySet = await getJwks();
      const { payload } = await jwtVerify(token, keySet, {
        issuer: config.issuerUrl,
        audience: config.audience,
      });
      const sub = typeof payload.sub === 'string' ? payload.sub : null;
      if (!sub) throw new Error('JWT missing `sub` claim.');
      const name = typeof payload['name'] === 'string' ? (payload['name'] as string) : null;
      const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : null;
      const rolesClaim = payload['roles'];
      const roles = Array.isArray(rolesClaim)
        ? rolesClaim.filter((r): r is string => typeof r === 'string')
        : [];
      return { sub, name, email, roles, raw: payload };
    },
  };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : url + '/';
}
