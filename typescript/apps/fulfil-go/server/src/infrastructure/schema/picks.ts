import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Pick work items — the pick context's aggregate. (client_id, part_id) is the
 * create-pick idempotency key; store_ref drives picker-scoped listing.
 */
export const picks = pgTable(
  'picks',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    storeRef: text('store_ref').notNull(),
    fulfilmentId: text('fulfilment_id').notNull(),
    partId: text('part_id').notNull(),
    shortId: text('short_id').notNull(),
    type: varchar('type', { length: 16 }).notNull(),
    serviceLevel: varchar('service_level', { length: 16 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('requested'),
    slotStart: timestampColumn('slot_start').notNull(),
    slotEnd: timestampColumn('slot_end').notNull(),
    timezone: text('timezone').notNull(),
    origin: jsonb('origin').notNull(),
    lines: jsonb('lines').notNull(),
    requireFullPick: boolean('require_full_pick').notNull(),
    allowSubstitutes: boolean('allow_substitutes').notNull(),
    releasedLate: boolean('released_late').notNull().default(false),
    /** Station line ordering, captured at intake from store settings. */
    sortAlgorithm: varchar('sort_algorithm', { length: 20 }).notNull().default('walk-sequence'),
    claimedBy: text('claimed_by'),
    claimedAt: timestampColumn('claimed_at'),
    lineResults: jsonb('line_results'),
    packages: jsonb('packages'),
    /** Bag-label allocation (docs/bag-label-printing.md); null until printed. */
    labels: jsonb('labels'),
    requiresVehicle: boolean('requires_vehicle'),
    completedAt: timestampColumn('completed_at'),
    failReason: text('fail_reason'),
    version: integer('version').notNull().default(1),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_picks_client_part').on(t.clientId, t.partId),
    index('idx_picks_store_status').on(t.clientId, t.storeRef, t.status),
  ],
);

export type NewPick = typeof picks.$inferInsert;
export type PickRow = typeof picks.$inferSelect;
