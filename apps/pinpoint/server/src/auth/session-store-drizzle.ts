import { count, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sessions, type SessionRow } from '../infrastructure/schema.js';
import {
  generateSessionId,
  newSession,
  type Session,
  type SessionStore,
} from './session-store.js';

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    sub: row.sub,
    name: row.name,
    email: row.email,
    codeVerifier: row.codeVerifier,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleSessionStore(db: PostgresJsDatabase): SessionStore {
  return {
    generateId: generateSessionId,

    async create(id: string, init: Partial<Session>): Promise<Session> {
      const session = newSession(id, init);
      await db.insert(sessions).values({
        id: session.id,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        sub: session.sub,
        name: session.name,
        email: session.email,
        codeVerifier: session.codeVerifier,
        state: session.state,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
      return session;
    },

    async get(id: string): Promise<Session | undefined> {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
      return row ? rowToSession(row) : undefined;
    },

    async update(id: string, patch: Partial<Session>): Promise<Session | undefined> {
      // Read-modify-write so we never blank a field the caller didn't
      // touch — Drizzle's `set` would coerce `undefined` keys away, but
      // being explicit makes the merge semantics match the in-memory
      // driver exactly.
      const [existingRow] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
      if (!existingRow) return undefined;
      const existing = rowToSession(existingRow);
      const merged: Session = { ...existing, ...patch, updatedAt: new Date() };
      await db
        .update(sessions)
        .set({
          accessToken: merged.accessToken,
          refreshToken: merged.refreshToken,
          sub: merged.sub,
          name: merged.name,
          email: merged.email,
          codeVerifier: merged.codeVerifier,
          state: merged.state,
          updatedAt: merged.updatedAt,
        })
        .where(eq(sessions.id, id));
      return merged;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(sessions).where(eq(sessions.id, id)).returning({
        id: sessions.id,
      });
      return result.length > 0;
    },

    async size(): Promise<number> {
      const [row] = await db.select({ value: count() }).from(sessions);
      return row?.value ?? 0;
    },
  };
}
