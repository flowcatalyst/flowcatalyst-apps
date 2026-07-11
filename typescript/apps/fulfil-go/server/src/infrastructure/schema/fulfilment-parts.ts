import { boolean, index, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Parts persist as rows of their own (they need per-part state + indexed
 * short ids for floor lookups) but they are NOT a separate aggregate — the
 * Fulfilment repository writes them inside the same persist call.
 */
export const fulfilmentParts = pgTable(
  'fulfilment_parts',
  {
    id: text('id').primaryKey(),
    fulfilmentId: text('fulfilment_id').notNull(),
    clientId: text('client_id').notNull(),
    shortId: varchar('short_id', { length: 6 }).notNull(),
    originRef: varchar('origin_ref', { length: 64 }).notNull(),
    origin: jsonb('origin').notNull(),
    lines: jsonb('lines').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    /**
     * PICK ACTUALS, captured from the pick context's part:picked event (the
     * fulfilment can never read back into the pick context): what was really
     * picked/substituted per line, the physical parcels, and whether moving
     * them needs a vehicle — the transport requester's inputs.
     */
    lineResults: jsonb('line_results'),
    packages: jsonb('packages'),
    requiresVehicle: boolean('requires_vehicle'),
    /**
     * Precomputed at creation (immutability: slots never change): the moment
     * this part becomes eligible for pick release. ASAP = createdAt;
     * STANDARD = slotStart − pickLeadTime. Existing rows default to now()
     * (due immediately).
     */
    releaseAt: timestampColumn('release_at').notNull().defaultNow(),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_fulfilment_parts_fulfilment').on(t.fulfilmentId),
    // The floor lookup: "part 1043 at store X".
    index('idx_fulfilment_parts_short').on(t.clientId, t.originRef, t.shortId),
    // The release sweep: pending parts due for pick release.
    index('idx_fulfilment_parts_release').on(t.status, t.releaseAt),
  ],
);

export type NewFulfilmentPart = typeof fulfilmentParts.$inferInsert;
export type FulfilmentPartRow = typeof fulfilmentParts.$inferSelect;
