import { sql } from 'drizzle-orm';
import { bigserial, customType, index, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/** 64-bit epoch-qualified transaction id (PG13+); postgres-js returns it as a string. */
const xid8 = customType<{ data: string }>({
  dataType() {
    return 'xid8';
  },
});

/**
 * Append-only event log backing SSE push + Last-Event-ID replay. `id` is a
 * bigserial — its monotonic order is the SSE event id contract. Rows are
 * appended inside the same tx as the aggregate write (via TransactionStore),
 * so a rolled-back command never leaks a sync event.
 *
 * `txid` records the writing transaction (pg_current_xact_id()). Sequence
 * values are allocated before commit, so under concurrent writers a row with
 * a LOWER id can become visible AFTER a higher id was already read — a
 * cursor that advanced past it would skip it forever. Every read therefore
 * only returns rows behind the visibility horizon: txid older than every
 * write transaction still in flight (see sync-event-repository). An AFTER
 * INSERT trigger also pg_notify()s 'fulfilgo_sync' so every node's broker
 * wakes on commit (multi-node nudge; see the sync_events_txid migration).
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
    txid: xid8('txid')
      .notNull()
      .default(sql`pg_current_xact_id()`),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_sync_events_channel_id').on(t.channel, t.id)],
);

export type NewSyncEvent = typeof syncEvents.$inferInsert;
export type SyncEventRow = typeof syncEvents.$inferSelect;
