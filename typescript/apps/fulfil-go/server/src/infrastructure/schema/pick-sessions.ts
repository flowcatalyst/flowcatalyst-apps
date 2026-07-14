import { boolean, index, integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * PROJECTION (see docs/projections.md): one flat, denormalized row per pick
 * — the store-side work session. Written transactionally at pick
 * transitions (requested → claimed → outcome) by pick-session-projection;
 * pk = pick id so every writer is an idempotent upsert. Handling time is
 * claim→complete COMBINED (pick+pack split deferred — the transition is
 * client-side; Andrew 2026-07-12).
 *
 * Consumers: stats views (pick_stats_daily — plain SQL, no ETL) and later
 * the flightboard. `source` is the external-hydration seam ('fulfil-go' |
 * 'external:<system>').
 */
export const pickSessions = pgTable(
  'pick_sessions',
  {
    pickId: text('pick_id').primaryKey(),
    clientId: text('client_id').notNull(),
    storeRef: text('store_ref').notNull(),
    fulfilmentId: text('fulfilment_id').notNull(),
    partId: text('part_id').notNull(),
    shortId: text('short_id').notNull(),
    serviceLevel: varchar('service_level', { length: 16 }).notNull(),
    requireFullPick: boolean('require_full_pick').notNull(),
    slotStart: timestampColumn('slot_start').notNull(),
    releasedLate: boolean('released_late').notNull().default(false),

    requestedAt: timestampColumn('requested_at').notNull(),
    claimedAt: timestampColumn('claimed_at'),
    completedAt: timestampColumn('completed_at'),
    pickerId: text('picker_id'),
    /** Claim → outcome, seconds (combined pick+pack handling time). */
    handlingSeconds: integer('handling_seconds'),

    /** picked | short_picked | failed — null while in flight. */
    outcome: varchar('outcome', { length: 20 }),
    failReason: text('fail_reason'),
    linesTotal: integer('lines_total').notNull(),
    unitsTotal: integer('units_total').notNull(),
    unitsPicked: integer('units_picked'),
    unitsSubstituted: integer('units_substituted'),
    packagesCount: integer('packages_count'),
    bagSizes: jsonb('bag_sizes'),
    requiresCarOrLarger: boolean('requires_car_or_larger'),
    /** Completed at or before slot start. */
    onTime: boolean('on_time'),
    /** Outcome 'picked' (no shorts). */
    inFull: boolean('in_full'),

    source: text('source').notNull().default('fulfil-go'),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_pick_sessions_store_slot').on(t.clientId, t.storeRef, t.slotStart),
    index('idx_pick_sessions_claimed').on(t.clientId, t.claimedAt),
  ],
);

export type PickSessionRow = typeof pickSessions.$inferSelect;
