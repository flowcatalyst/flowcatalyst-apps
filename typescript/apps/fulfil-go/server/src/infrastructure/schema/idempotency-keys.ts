import { integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Stored responses for idempotent command endpoints. The mobile offline
 * queue sends a TSID `Idempotency-Key` header with each mutation; a replayed
 * key returns the stored response instead of re-executing the command.
 * Primary-key uniqueness is the dedupe mechanism — a concurrent duplicate
 * loses the insert race and replays the winner's stored response.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  key: varchar('key', { length: 128 }).primaryKey(),
  principalId: text('principal_id').notNull(),
  endpoint: text('endpoint').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body'),
  createdAt: timestampColumn('created_at').notNull().defaultNow(),
});

export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
