/**
 * Auth configuration loaded from environment variables.
 *
 * OAuth client topology: ONE client per user-facing app (execution, picking,
 * management) — separate redirect allowlists, separate revocation/rotation,
 * distinct client_ids in platform audit logs. The apps name themselves via
 * the `app` field on the mobile auth routes; the broker picks the matching
 * client. A `default` client (plain OIDC_CLIENT_ID) is the fallback for
 * requests that don't name an app — convenient for single-client dev setups.
 *
 * No session store: fulfil-go's clients hold their own tokens; the server is
 * stateless (bearer validation only).
 */
export const FULFILGO_APPS = ['execution', 'picking', 'management'] as const;
export type FulfilGoApp = (typeof FULFILGO_APPS)[number];

export interface OidcClientConfig {
  readonly clientId: string;
  readonly clientSecret: string | null;
  /** Redirect URIs this app may request (deep-link schemes + dev origins). */
  readonly allowedRedirectUris: readonly string[];
}

export interface OidcConfig {
  readonly issuerUrl: string;
  readonly audience: string;
  /**
   * Comma-separated OAuth scopes requested at authorize time.
   * `offline_access` is included by default — the mobile apps need refresh
   * tokens for the offline queue and the telemetry uploader's native refresh.
   */
  readonly scopes: string;
  /** Per-app OAuth clients + optional 'default' fallback. */
  readonly clients: Partial<Record<FulfilGoApp | 'default', OidcClientConfig>>;
}

/**
 * Picker session config — the fulfil-go-issued token plane for the shared
 * picking station (separate from platform OIDC above). See
 * `docs/pick-context-auth.md`.
 */
export interface PickerAuthConfig {
  /** HS256 signing secret. Dev default used when unset — NEVER in production. */
  readonly secret: string;
  /** JWT `iss` — also the routing key that distinguishes picker tokens. */
  readonly issuer: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  /** Failed-PIN attempts before a picker locks out. */
  readonly pinMaxAttempts: number;
  /** Lockout duration (ms) once pinMaxAttempts is hit. */
  readonly lockoutMs: number;
  /** True when falling back to the built-in dev secret (unset env) — warn on boot. */
  readonly usingDevSecret: boolean;
}

export interface AuthConfig {
  /** When non-null, OIDC is wired: token validation + the mobile auth routes. */
  readonly oidc: OidcConfig | null;
  /**
   * When true, `extractRequestToken` falls back to the `x-user-id` header
   * for unauthenticated requests. Local dev / tests only; MUST be false in
   * production.
   */
  readonly devFallback: boolean;
  /** Picker session token plane (always present; secret may be the dev default). */
  readonly picker: PickerAuthConfig;
}

// Fixed, obviously-insecure secret so local dev / tests run without env setup.
// server.ts logs a warning when this is in use.
const DEV_PICKER_SECRET = 'dev-insecure-picker-session-secret-change-me';

const DEFAULT_REDIRECTS: Record<FulfilGoApp, readonly string[]> = {
  execution: ['fulfilgo-exec://auth/callback', 'http://localhost:5175/auth/callback'],
  picking: ['fulfilgo-pick://auth/callback', 'http://localhost:5176/auth/callback'],
  management: ['http://localhost:5177/auth/callback'],
};

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function loadAppClient(app: FulfilGoApp): OidcClientConfig | undefined {
  const key = app.toUpperCase();
  const clientId = (process.env[`FULFILGO_OIDC_${key}_CLIENT_ID`] ?? '').trim();
  if (clientId.length === 0) return undefined;
  const redirects = parseList(process.env[`FULFILGO_OIDC_${key}_REDIRECT_URIS`]);
  return {
    clientId,
    clientSecret: (process.env[`FULFILGO_OIDC_${key}_CLIENT_SECRET`] ?? '').trim() || null,
    allowedRedirectUris: redirects.length > 0 ? redirects : DEFAULT_REDIRECTS[app],
  };
}

export function loadAuthConfig(): AuthConfig {
  const issuerUrl = (process.env['OIDC_ISSUER_URL'] ?? '').trim();
  const audience = (process.env['OIDC_AUDIENCE'] ?? '').trim();
  const scopes = (process.env['OIDC_SCOPES'] ?? 'openid profile email offline_access').trim();
  const devFallback =
    (process.env['FULFILGO_AUTH_DEV_FALLBACK'] ?? 'false').toLowerCase() === 'true';

  const pickerSecret = (process.env['PICKER_SESSION_SECRET'] ?? '').trim();
  const picker: PickerAuthConfig = {
    secret: pickerSecret.length > 0 ? pickerSecret : DEV_PICKER_SECRET,
    issuer: (process.env['PICKER_SESSION_ISSUER'] ?? '').trim() || 'fulfilgo-pick',
    accessTtlSeconds: Number(process.env['PICKER_ACCESS_TTL'] ?? 900), // 15 min
    refreshTtlSeconds: Number(process.env['PICKER_REFRESH_TTL'] ?? 12 * 3600), // 12 h
    pinMaxAttempts: Number(process.env['PICKER_PIN_MAX_ATTEMPTS'] ?? 5),
    lockoutMs: Number(process.env['PICKER_LOCK_MINUTES'] ?? 5) * 60_000,
    usingDevSecret: pickerSecret.length === 0,
  };

  // OIDC is only wired when the issuer URL is set. Audience defaults (in the
  // token validator) to the discovery issuer: the FlowCatalyst platform
  // stamps access tokens with `aud == iss == <base URL>` — NOT the client_id
  // (that's the ID-token aud). Only set OIDC_AUDIENCE to override.
  if (issuerUrl.length === 0) {
    return { oidc: null, devFallback, picker };
  }

  const clients: Partial<Record<FulfilGoApp | 'default', OidcClientConfig>> = {};
  for (const app of FULFILGO_APPS) {
    const client = loadAppClient(app);
    if (client) clients[app] = client;
  }
  const defaultClientId = (process.env['OIDC_CLIENT_ID'] ?? '').trim();
  if (defaultClientId.length > 0) {
    const redirects = parseList(process.env['FULFILGO_AUTH_REDIRECT_URIS']);
    clients['default'] = {
      clientId: defaultClientId,
      clientSecret: (process.env['OIDC_CLIENT_SECRET'] ?? '').trim() || null,
      allowedRedirectUris:
        redirects.length > 0 ? redirects : Object.values(DEFAULT_REDIRECTS).flat(),
    };
  }

  return {
    oidc: { issuerUrl, audience, scopes, clients },
    devFallback,
    picker,
  };
}
