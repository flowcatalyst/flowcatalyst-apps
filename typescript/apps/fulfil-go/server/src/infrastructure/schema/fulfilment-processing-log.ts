import { bigserial, index, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Append-only per-fulfilment timeline, written in the same tx as the state
 * change it describes (sync_events pattern). Observability only — nothing
 * reads it to make decisions, and it stays OUT of the aggregate so unbounded
 * growth never rides the optimistic-concurrency payload.
 */
export const fulfilmentProcessingLog = pgTable(
  'fulfilment_processing_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    clientId: text('client_id').notNull(),
    fulfilmentId: text('fulfilment_id').notNull(),
    at: timestampColumn('at').notNull().defaultNow(),
    /** Principal id or system identity that caused the entry. */
    actor: text('actor').notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    message: text('message').notNull(),
    data: jsonb('data'),
  },
  (t) => [index('idx_fulfilment_log_fulfilment').on(t.fulfilmentId, t.id)],
);

export type NewFulfilmentLogEntry = typeof fulfilmentProcessingLog.$inferInsert;
export type FulfilmentLogRow = typeof fulfilmentProcessingLog.$inferSelect;
