import { bigserial, index, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Append-only event log backing SSE push + Last-Event-ID replay. `id` is a
 * bigserial — its monotonic order is the SSE event id contract. Rows are
 * appended inside the same tx as the aggregate write (via TransactionStore),
 * so a rolled-back command never leaks a sync event.
 *
 * mode 'number' is safe: ids stay far below 2^53 for any realistic lifetime,
 * and the wire contract (DeltaSyncResponse.latestEventId) is a string anyway.
 */
export const syncEvents = pgTable(
  'sync_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    channel: varchar('channel', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_sync_events_channel_id').on(t.channel, t.id)],
);

export type NewSyncEvent = typeof syncEvents.$inferInsert;
export type SyncEventRow = typeof syncEvents.$inferSelect;
