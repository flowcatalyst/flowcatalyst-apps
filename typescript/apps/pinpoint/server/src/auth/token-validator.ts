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
  /**
   * Principal tier from the FlowCatalyst token (`tier` claim), e.g.
   * `"ANCHOR"` for a super-admin. Used by permission resolution to grant
   * anchors every permission. Null when absent.
   */
  readonly tier: string | null;
  /**
   * Clients the principal can act on (`clients` claim). `["*"]` marks an
   * anchor (all clients) — the SDK's canonical super-admin signal.
   */
  readonly clients: readonly string[];
  /**
   * Granted permission strings from the space-delimited `scope` claim. The
   * platform expands a principal's assigned roles into this list; pinpoint
   * keeps the entries that are real `pinpoint:*` permissions.
   */
  readonly scopes: readonly string[];
  /** `all_applications` claim — true for principals with access to every app. */
  readonly allApplications: boolean;
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
  // Issuer the tokens are actually stamped with — taken from the discovery
  // document, NOT from `config.issuerUrl`. They usually match, but the
  // discovery `issuer` is the authoritative value the IdP signs into the
  // `iss` claim, so we verify against it (this is what the FlowCatalyst SDK
  // does — see @flowcatalyst/sdk/fastify/oidc/discovery).
  let discoveryIssuer: string | null = null;
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
    const doc = (await response.json()) as { jwks_uri?: string; issuer?: string };
    if (!doc.jwks_uri) {
      throw new Error(`OIDC discovery document missing jwks_uri (issuer ${config.issuerUrl}).`);
    }
    discoveryIssuer = doc.issuer ?? config.issuerUrl;
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
      // Audience IS enforced. The FlowCatalyst platform mints ACCESS tokens
      // with `aud == iss == <platform base URL>` (flowcatalyst-go
      // wire_services.go), and stamps ID tokens with `aud == client_id`
      // instead — both signed with the same key — specifically so that
      // enforcing `aud == issuer` rejects an ID token presented as a bearer.
      // So the expected audience defaults to the discovery issuer (== the
      // access-token `aud`); OIDC_AUDIENCE overrides for other deployments.
      const expectedAudience =
        config.audience.length > 0 ? config.audience : (discoveryIssuer ?? config.issuerUrl);
      const { payload } = await jwtVerify(token, keySet, {
        issuer: discoveryIssuer ?? config.issuerUrl,
        audience: expectedAudience,
      });
      const sub = typeof payload.sub === 'string' ? payload.sub : null;
      if (!sub) throw new Error('JWT missing `sub` claim.');
      const name = typeof payload['name'] === 'string' ? (payload['name'] as string) : null;
      const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : null;
      const rolesClaim = payload['roles'];
      const roles = Array.isArray(rolesClaim)
        ? rolesClaim.filter((r): r is string => typeof r === 'string')
        : [];
      const tier = typeof payload['tier'] === 'string' ? (payload['tier'] as string) : null;
      const clientsClaim = payload['clients'];
      const clients = Array.isArray(clientsClaim)
        ? clientsClaim.filter((c): c is string => typeof c === 'string')
        : [];
      const scopeClaim = payload['scope'];
      const scopes =
        typeof scopeClaim === 'string' ? scopeClaim.split(/\s+/).filter((s) => s.length > 0) : [];
      const allApplications = payload['all_applications'] === true;
      return { sub, name, email, roles, tier, clients, scopes, allApplications, raw: payload };
    },
  };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : url + '/';
}
