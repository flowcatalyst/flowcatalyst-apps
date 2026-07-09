import type { MobileTokenResponse } from '@fulfil-go/shared';
import type { TokenProvider } from '../http/api-client.js';
import type { StoredTokens, TokenStore } from './token-store.js';

/** Refresh this far before the advertised expiry. */
const EXPIRY_SKEW_MS = 60_000;

export interface Session extends TokenProvider {
  isAuthenticated(): Promise<boolean>;
  setTokens(tokens: MobileTokenResponse): Promise<void>;
  signOut(): Promise<void>;
  /** Current refresh token — handed to the Transistorsoft `authorization` config. */
  getRefreshToken(): Promise<string | null>;
}

export interface SessionOptions {
  /** Which server-side OAuth client refreshes go through. */
  readonly app?: string;
  readonly store: TokenStore;
  /** Server base URL — refresh goes to POST {baseUrl}/auth/mobile/refresh. */
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  /** Called when a refresh fails terminally (signed out). */
  readonly onSignedOut?: () => void;
}

export function createSession(options: SessionOptions): Session {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  // Single-flight: concurrent 401s trigger one refresh, not a stampede.
  let refreshing: Promise<boolean> | null = null;

  async function persist(tokens: MobileTokenResponse, priorRefresh: string | null): Promise<void> {
    const stored: StoredTokens = {
      accessToken: tokens.accessToken,
      // The platform may or may not rotate refresh tokens — keep the old one
      // when the response omits it.
      refreshToken: tokens.refreshToken ?? priorRefresh,
      expiresAt: tokens.expiresAt,
    };
    await options.store.save(stored);
  }

  async function doRefresh(): Promise<boolean> {
    const current = await options.store.load();
    if (!current?.refreshToken) return false;
    try {
      const res = await fetchImpl(`${baseUrl}/auth/mobile/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(options.app ? { app: options.app } : {}),
          refreshToken: current.refreshToken,
        }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          await options.store.clear();
          options.onSignedOut?.();
        }
        return false;
      }
      await persist((await res.json()) as MobileTokenResponse, current.refreshToken);
      return true;
    } catch {
      // Network failure — keep tokens, caller retries later.
      return false;
    }
  }

  return {
    async getAccessToken(): Promise<string | null> {
      const current = await options.store.load();
      if (!current) return null;
      if (current.expiresAt - EXPIRY_SKEW_MS > Date.now()) return current.accessToken;
      const ok = await this.refresh();
      if (!ok) return null;
      return (await options.store.load())?.accessToken ?? null;
    },

    async refresh(): Promise<boolean> {
      refreshing ??= doRefresh().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },

    async isAuthenticated(): Promise<boolean> {
      const current = await options.store.load();
      return current !== null && current.refreshToken !== null;
    },

    async setTokens(tokens: MobileTokenResponse): Promise<void> {
      await persist(tokens, null);
    },

    async signOut(): Promise<void> {
      await options.store.clear();
      options.onSignedOut?.();
    },

    async getRefreshToken(): Promise<string | null> {
      return (await options.store.load())?.refreshToken ?? null;
    },
  };
}
