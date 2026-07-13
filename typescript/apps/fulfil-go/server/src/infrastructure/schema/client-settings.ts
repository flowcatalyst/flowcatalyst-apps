import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Per-client operational settings (shared `ClientSettingsSchema`) — the
 * client-level counterpart of store profiles. One row per client, sparse:
 * absent fields fall through to code defaults via `resolveClientSettings`.
 * Reference data (plain idempotent upserts), not an aggregate.
 */
export const clientSettings = pgTable('client_settings', {
  clientId: text('client_id').primaryKey(),
  settings: jsonb('settings').notNull(),
  updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
});

export type ClientSettingsRow = typeof clientSettings.$inferSelect;
