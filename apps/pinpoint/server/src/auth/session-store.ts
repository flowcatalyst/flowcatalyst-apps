import { randomBytes } from 'node:crypto';

/**
 * In-memory session store. Matches the Rust pinpoint's `HashMap<String, Session>`
 * shape — sessions live for the lifetime of the process, lost on restart.
 *
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
 * For a multi-instance deploy this needs to move to Redis or DB-backed
 * storage so sessions survive restarts and load-balance across replicas;
 * tracked in Slice 12.3+.
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
  create(id: string, init: Partial<Session>): Session;
  get(id: string): Session | undefined;
  update(id: string, patch: Partial<Session>): Session | undefined;
  delete(id: string): boolean;
  /** Size — useful for ops + diagnostics. Not load-bearing. */
  size(): number;
}

export function createInMemorySessionStore(): SessionStore {
  const sessions = new Map<string, Session>();

  return {
    generateId(): string {
      // 32 bytes → 43 base64url chars. Matches the Rust pinpoint generator.
      return randomBytes(32).toString('base64url');
    },

    create(id: string, init: Partial<Session>): Session {
      const now = new Date();
      const session: Session = {
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
      sessions.set(id, session);
      return session;
    },

    get(id: string): Session | undefined {
      return sessions.get(id);
    },

    update(id: string, patch: Partial<Session>): Session | undefined {
      const existing = sessions.get(id);
      if (!existing) return undefined;
      const updated: Session = { ...existing, ...patch, updatedAt: new Date() };
      sessions.set(id, updated);
      return updated;
    },

    delete(id: string): boolean {
      return sessions.delete(id);
    },

    size(): number {
      return sessions.size;
    },
  };
}
