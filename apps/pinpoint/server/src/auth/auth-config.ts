/**
 * Auth configuration loaded from environment variables. Mirrors the Rust
 * pinpoint's `AppConfig` OIDC fields: issuer URL, audience, client id +
 * optional secret, redirect URI. The dev fallback flag opts the
 * `x-user-id` header path back on for local dev — never in production.
 */
export interface OidcConfig {
  readonly issuerUrl: string;
  readonly audience: string;
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly redirectUri: string;
  /**
   * Comma-separated list of OAuth scopes requested at /auth/login. Defaults
   * to `openid profile email` per OIDC spec; override if the IdP needs more
   * (e.g. `openid profile email roles offline_access`).
   */
  readonly scopes: string;
  /**
   * Opt-in to non-HTTPS IdP endpoints. openid-client v6 refuses
   * plaintext HTTP by default (`OAUTH_HTTP_REQUEST_FORBIDDEN`). Tests
   * point at an in-process fake IdP on `http://127.0.0.1:<port>/`,
   * so the test rig flips this to true. NEVER enable in production
   * — there's no env loader for this flag for that reason.
   */
  readonly allowInsecureRequests?: boolean;
}

/**
 * Session-store driver selection.
 *
 * - `memory` (default) — `Map<sessionId, Session>`. Lost on restart, not
 *   shared across replicas. Fine for single-instance local dev and tests.
 * - `redis` — `ioredis` client against `PINPOINT_SESSION_REDIS_URL`.
 *   Sessions survive restarts and are shared across replicas. Required
 *   for any multi-instance deploy.
 * - `postgres` — re-uses the app's Drizzle DB connection. Same
 *   restart/replica properties as Redis, no new infra dependency. Slower
 *   per-request than Redis but acceptable for low-traffic deployments.
 */
export type SessionDriver = 'memory' | 'redis' | 'postgres';

export interface SessionConfig {
  readonly driver: SessionDriver;
  /** Required when `driver === 'redis'`. */
  readonly redisUrl: string | null;
}

export interface AuthConfig {
  /** When non-null, OIDC is wired and the session-cookie path is enabled. */
  readonly oidc: OidcConfig | null;
  /**
   * When true, the `extractRequestToken` falls back to the `x-user-id`
   * header for unauthenticated requests. Convenient for local dev (no IdP
   * needed) and integration tests; MUST be false in production.
   */
  readonly devFallback: boolean;
  /**
   * Where to send the user after successful login. Default `/`. Useful
   * to override in tests or for embedded deployments.
   */
  readonly postLoginRedirect: string;
  /** How the session store persists rows. See `SessionDriver`. */
  readonly session: SessionConfig;
}

export function loadAuthConfig(): AuthConfig {
  const issuerUrl = (process.env['OIDC_ISSUER_URL'] ?? '').trim();
  const audience = (process.env['OIDC_AUDIENCE'] ?? '').trim();
  const clientId = (process.env['OIDC_CLIENT_ID'] ?? 'pinpoint').trim();
  const clientSecret = (process.env['OIDC_CLIENT_SECRET'] ?? '').trim() || null;
  const redirectUri = (
    process.env['OIDC_REDIRECT_URI'] ?? 'http://localhost:3000/auth/callback'
  ).trim();
  const scopes = (process.env['OIDC_SCOPES'] ?? 'openid profile email').trim();
  const devFallback = (process.env['PINPOINT_AUTH_DEV_FALLBACK'] ?? 'false').toLowerCase() === 'true';
  const postLoginRedirect = (process.env['PINPOINT_AUTH_POST_LOGIN_REDIRECT'] ?? '/').trim();

  // OIDC is only wired when the issuer URL is set. Audience is required
  // for JWT verification (audience claim check); we don't fall back to a
  // default because an empty audience is a security footgun.
  const oidc: OidcConfig | null =
    issuerUrl.length > 0
      ? {
          issuerUrl,
          audience: audience.length > 0 ? audience : clientId,
          clientId,
          clientSecret,
          redirectUri,
          scopes,
        }
      : null;

  const rawDriver = (process.env['PINPOINT_SESSION_DRIVER'] ?? 'memory').toLowerCase();
  const driver: SessionDriver =
    rawDriver === 'redis' || rawDriver === 'postgres' ? rawDriver : 'memory';
  const redisUrl = (process.env['PINPOINT_SESSION_REDIS_URL'] ?? '').trim() || null;
  if (driver === 'redis' && redisUrl === null) {
    throw new Error(
      'PINPOINT_SESSION_DRIVER=redis requires PINPOINT_SESSION_REDIS_URL to be set.',
    );
  }
  const session: SessionConfig = { driver, redisUrl };

  return { oidc, devFallback, postLoginRedirect, session };
}
