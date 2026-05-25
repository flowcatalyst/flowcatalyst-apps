import { randomBytes } from 'node:crypto';

/**
 * Sessions hold two distinct payloads:
 *   1. The in-flight auth flow: `codeVerifier` + `state` set at /auth/login
 *      and consumed at /auth/callback. The session row is created at /login
 *      time so the cookie can be set BEFORE the IdP redirect — without it,
 *      the callback has no way to tie the request back to its pre-redirect
 *      state.
 *   2. The authenticated user: `accessToken`, `refreshToken`, `sub`, `name`,
 *      `email`. Populated at /auth/callback after the token exchange.
 *
 * A single sessionId rides both phases; the in-flight fields are cleared
 * after the callback to free memory.
 *
 * Three driver impls live alongside this interface: in-memory (default,
 * lost on restart), Redis (`createRedisSessionStore`), and Postgres
 * (`createDrizzleSessionStore`). Driver selection is env-driven in
 * `createAppContext` — see `PINPOINT_SESSION_DRIVER`.
 */
export interface Session {
  readonly id: string;
  /** Bearer access token from the IdP. Empty string until callback completes. */
  accessToken: string;
  refreshToken: string | null;
  /** OIDC `sub` claim — the principal id we look up downstream. */
  sub: string | null;
  name: string | null;
  email: string | null;
  /** PKCE verifier, set at /login, consumed at /callback. */
  codeVerifier: string | null;
  /** Anti-CSRF state, set at /login, validated at /callback. */
  state: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionStore {
  generateId(): string;
  create(id: string, init: Partial<Session>): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
  update(id: string, patch: Partial<Session>): Promise<Session | undefined>;
  delete(id: string): Promise<boolean>;
  /** Size — useful for ops + diagnostics. Not load-bearing. */
  size(): Promise<number>;
}

/**
 * 32 bytes → 43 base64url chars. Matches the Rust pinpoint generator.
 * Shared across all driver impls.
 */
export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Build a complete Session row from a partial init. Used by every driver
 * impl to fill in defaults for the in-flight fields that `/auth/login`
 * doesn't set yet.
 */
export function newSession(id: string, init: Partial<Session>, now: Date = new Date()): Session {
  return {
    id,
    accessToken: init.accessToken ?? '',
    refreshToken: init.refreshToken ?? null,
    sub: init.sub ?? null,
    name: init.name ?? null,
    email: init.email ?? null,
    codeVerifier: init.codeVerifier ?? null,
    state: init.state ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createInMemorySessionStore(): SessionStore {
  const sessions = new Map<string, Session>();

  return {
    generateId: generateSessionId,

    async create(id: string, init: Partial<Session>): Promise<Session> {
      const session = newSession(id, init);
      sessions.set(id, session);
      return session;
    },

    async get(id: string): Promise<Session | undefined> {
      return sessions.get(id);
    },

    async update(id: string, patch: Partial<Session>): Promise<Session | undefined> {
      const existing = sessions.get(id);
      if (!existing) return undefined;
      const updated: Session = { ...existing, ...patch, updatedAt: new Date() };
      sessions.set(id, updated);
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      return sessions.delete(id);
    },

    async size(): Promise<number> {
      return sessions.size;
    },
  };
}
