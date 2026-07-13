import { bigserial, index, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * The ACTIVITY LOG (docs/activity-log.md) — one append-only chain record for
 * everything that HAPPENED to a fulfilment's chain: domain transitions,
 * platform event receipts (including replays ACKed but ignored), third-party
 * calls and their responses (Uber quote/book, EPOD provisioning/route push),
 * provider webhooks, admin actions. `fulfilment_id` is the ROOT correlation,
 * stamped by every writer (the lower chain always knows its root); nullable
 * only for entries with no fulfilment chain.
 *
 * Domain writes ride the same tx as the state change (sync_events pattern);
 * external interactions append best-effort AFTER the response. Observability
 * first — the one sanctioned decision-making read is the process manager's
 * dispatch guard (`hasEntry`, e.g. category 'epod-provision-dispatched' —
 * deciders with no aggregate transition to lean on). It stays OUT of the
 * aggregate so unbounded growth never rides the optimistic-concurrency
 * payload. Long-lived (unlike sync_events, which prunes).
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    clientId: text('client_id').notNull(),
    /** Root chain correlation — null only when the entry has no chain. */
    fulfilmentId: text('fulfilment_id'),
    /** 'fulfilment' | 'part' | 'pick' | 'transport_order' | 'trip' */
    subjectType: varchar('subject_type', { length: 24 }).notNull(),
    subjectId: text('subject_id').notNull(),
    at: timestampColumn('at').notNull().defaultNow(),
    /** Principal id or system identity that caused the entry. */
    actor: text('actor').notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    /** 'domain' | 'platform' | 'uber' | 'epod' | 'admin' */
    source: varchar('source', { length: 16 }).notNull(),
    message: text('message').notNull(),
    data: jsonb('data'),
  },
  (t) => [
    // fulfilment_id leads (ids are globally-unique TSIDs — client adds no
    // selectivity and no read passes it); category second serves `hasEntry`,
    // the PM dispatch guard on every webhook decision, without relying on
    // PG18 skip scan. Timeline reads use the prefix; per-chain sets are
    // small, sorting by id in-process is free.
    index('idx_activity_log_fulfilment').on(t.fulfilmentId, t.category),
    index('idx_activity_log_subject').on(t.subjectType, t.subjectId),
  ],
);

export type NewActivityLogEntry = typeof activityLog.$inferInsert;
export type ActivityLogRow = typeof activityLog.$inferSelect;
