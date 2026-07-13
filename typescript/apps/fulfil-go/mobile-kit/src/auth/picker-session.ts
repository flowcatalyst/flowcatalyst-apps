/**
 * Picker session — the pick context's LOCAL credential strategy for the
 * shared-station picking app (see docs/pick-context-auth.md). Same
 * TokenProvider surface as the OIDC `createSession` so `createApiClient`
 * doesn't care which plane it's on; only credential acquisition differs:
 * staff-code+PIN (or later a QR badge scan) against /pick-auth instead of
 * the PKCE browser round trip.
 */
import type { PickerTokenResponse } from '@fulfil-go/shared';
import type { TokenProvider } from '../http/api-client.js';
import type { StoredTokens, TokenStore } from './token-store.js';

/** Refresh this far before expiry (picker access TTL defaults to 15 min). */
const EXPIRY_SKEW_MS = 60_000;

export interface PinLoginInput {
  readonly clientId: string;
  readonly storeRef: string;
  readonly staffCode: string;
  readonly pin: string;
}

/** Driver login — same plane, depot-bound (the depots registry). */
export interface DriverPinLoginInput {
  readonly clientId: string;
  readonly depotRef: string;
  readonly staffCode: string;
  readonly pin: string;
}

export class PickerLoginError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PickerLoginError';
  }
}

/**
 * Staff-code + PIN login. Throws PickerLoginError with the server's code
 * (INVALID_CREDENTIALS, PICKER_LOCKED, …) so the login screen can message
 * precisely. The caller hands the result to `session.setSession(...)`.
 */
export async function pickerPinLogin(
  baseUrl: string,
  input: PinLoginInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PickerTokenResponse> {
  const res = await fetchImpl(
    `${baseUrl.replace(/\/$/, '')}/clients/${encodeURIComponent(input.clientId)}/pick-auth/login/pin`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        storeRef: input.storeRef,
        staffCode: input.staffCode,
        pin: input.pin,
      }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new PickerLoginError(
      res.status,
      body.code ?? 'LOGIN_FAILED',
      body.message ?? `Login failed (${res.status}).`,
    );
  }
  return (await res.json()) as PickerTokenResponse;
}

/**
 * Driver staff-code + PIN login against /driver-auth — the transport
 * context's mirror of the picker plane (depot-bound instead of store-bound).
 */
export async function driverPinLogin(
  baseUrl: string,
  input: DriverPinLoginInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PickerTokenResponse> {
  const res = await fetchImpl(
    `${baseUrl.replace(/\/$/, '')}/clients/${encodeURIComponent(input.clientId)}/driver-auth/login/pin`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        depotRef: input.depotRef,
        staffCode: input.staffCode,
        pin: input.pin,
      }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new PickerLoginError(
      res.status,
      body.code ?? 'LOGIN_FAILED',
      body.message ?? `Login failed (${res.status}).`,
    );
  }
  return (await res.json()) as PickerTokenResponse;
}

export interface PickerSession extends TokenProvider {
  isAuthenticated(): Promise<boolean>;
  /** Persist a login/refresh response. */
  setSession(tokens: PickerTokenResponse): Promise<void>;
  /** Person sign-out (Exit) — the station/device binding is not touched. */
  signOut(): Promise<void>;
}

export interface PickerSessionOptions {
  readonly store: TokenStore;
  readonly baseUrl: string;
  /** Live station binding — refresh goes to the station's current client. */
  readonly getClientId: () => string | null;
  /** Auth route base: 'pick-auth' (default) or 'driver-auth'. */
  readonly authBasePath?: string;
  readonly fetchImpl?: typeof fetch;
  /** Called when a refresh fails terminally (session ended server-side). */
  readonly onSignedOut?: () => void;
}

export function createPickerSession(options: PickerSessionOptions): PickerSession {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const authBasePath = options.authBasePath ?? 'pick-auth';
  // Single-flight: concurrent 401s trigger one refresh, not a stampede.
  let refreshing: Promise<boolean> | null = null;

  async function persist(tokens: PickerTokenResponse): Promise<void> {
    const stored: StoredTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    };
    await options.store.save(stored);
  }

  async function doRefresh(): Promise<boolean> {
    const current = await options.store.load();
    const clientId = options.getClientId();
    if (!current?.refreshToken || !clientId) return false;
    try {
      const res = await fetchImpl(
        `${baseUrl}/clients/${encodeURIComponent(clientId)}/${authBasePath}/refresh`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        },
      );
      if (!res.ok) {
        if (res.status === 401) {
          // Invalid/expired token, or the picker was suspended/moved store.
          await options.store.clear();
          options.onSignedOut?.();
        }
        return false;
      }
      await persist((await res.json()) as PickerTokenResponse);
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

    async setSession(tokens: PickerTokenResponse): Promise<void> {
      await persist(tokens);
    },

    async signOut(): Promise<void> {
      await options.store.clear();
      options.onSignedOut?.();
    },
  };
}
