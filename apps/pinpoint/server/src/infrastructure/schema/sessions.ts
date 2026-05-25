/**
 * Session store — Postgres-backed driver. Used when
 * `PINPOINT_SESSION_DRIVER=postgres`. The in-memory + Redis drivers are
 * the other two impls; see `src/auth/session-store-*.ts`.
 *
 * Schema mirrors the `Session` interface 1:1 (`id` PK + a nullable column
 * per field). `accessToken` defaults to empty string to match the
 * "row created at /auth/login before the IdP redirect" lifecycle — the
 * token is filled in at /auth/callback.
 */
import { pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  accessToken: text('access_token').notNull().default(''),
  refreshToken: text('refresh_token'),
  sub: text('sub'),
  name: text('name'),
  email: text('email'),
  codeVerifier: text('code_verifier'),
  state: text('state'),
  createdAt: timestampColumn('created_at').notNull().defaultNow(),
  updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
});

export type NewSession = typeof sessions.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
