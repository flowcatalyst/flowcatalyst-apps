/**
 * In-band session-cookie refresh. Called by `extractRequestToken`
 * when the access token on a session failed validation (typically
 * because it expired). Uses the session's refresh token to mint a
 * new pair via the OIDC client, persists them on the session, and
 * returns the new claims as a RequestToken.
 *
 * Concurrent-request safety: rotating-refresh-token IdPs (the common
 * case) single-use the refresh token, so two parallel refreshes for
 * the same session would race and one would get `invalid_grant`.
 * We re-read the session before refreshing in case another request
 * already swapped the token — if it did, we try the freshly-stored
 * access token first. This isn't a full mutex; it's the cheapest
 * thing that turns the common race into a no-op. Backend lock-per-
 * session can land if the audit ever shows it matters.
 *
 * Returns `null` on any failure; the caller falls through to 401 and
 * the SPA bounces through `/auth/login`.
 */
import type { RequestToken } from '@pinpoint/framework';
import type { OidcClient } from './oidc-client.js';
import { resolvePermissions } from './role-permissions.js';
import type { Session, SessionStore } from './session-store.js';
import type { TokenValidator } from './token-validator.js';

/** Minimal logger interface — structurally compatible with Pino / FastifyBaseLogger. */
export interface RefreshLogger {
  warn(meta: Record<string, unknown>, msg: string): void;
}

export interface RefreshSessionDeps {
  readonly oidcClient: OidcClient | null;
  readonly tokenValidator: TokenValidator | null;
  readonly sessionStore: SessionStore;
  readonly log: RefreshLogger;
}

export async function tryRefreshSession(
  deps: RefreshSessionDeps,
  originalSession: Session,
): Promise<RequestToken | null> {
  const { oidcClient, sessionStore, tokenValidator, log } = deps;
  if (!oidcClient || !tokenValidator) return null;

  // Re-read in case another concurrent request already refreshed.
  const latest = await sessionStore.get(originalSession.id);
  if (!latest) return null;

  if (latest.accessToken.length > 0 && latest.accessToken !== originalSession.accessToken) {
    try {
      const claims = await tokenValidator.validate(latest.accessToken);
      return {
        sub: claims.sub,
        permissions: resolvePermissions(claims),
      };
    } catch {
      // The other refresh also produced a stale-on-arrival token.
      // Fall through to attempt our own refresh.
    }
  }

  if (!latest.refreshToken) return null;

  try {
    const tokens = await oidcClient.refresh(latest.refreshToken);
    await sessionStore.update(latest.id, {
      accessToken: tokens.accessToken,
      // Some IdPs rotate refresh tokens, some don't. When the response
      // omits a new refresh_token we keep the old one (the spec allows
      // the old token to stay valid in that case).
      refreshToken: tokens.refreshToken ?? latest.refreshToken,
    });
    const claims = await tokenValidator.validate(tokens.accessToken);
    return {
      sub: claims.sub,
      permissions: resolvePermissions(claims),
    };
  } catch (err) {
    log.warn({ err, sessionId: latest.id }, 'OIDC token refresh failed');
    return null;
  }
}
