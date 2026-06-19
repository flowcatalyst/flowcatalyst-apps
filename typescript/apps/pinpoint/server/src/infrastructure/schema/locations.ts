/**
 * Locations — raw addresses captured for resolution, linked to a
 * `master_locations` row once the matching pipeline finds or creates one.
 *
 * Slice 3 landed the full column set (raw + normalized + match info +
 * status); Slice 8 adds the FK on `master_location_id` + the
 * raw_suburb/normalized_suburb columns from Rust migration 014, and the
 * matching pipeline (rewritten `create-location` use case) actually
 * populates the normalized + match info.
 */
import { doublePrecision, index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { clients } from './clients.js';
import { partitions } from './partitions.js';
import { masterLocations } from './master-locations.js';

export const locations = pgTable(
  'locations',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    partitionId: text('partition_id').references(() => partitions.id),
    masterLocationId: text('master_location_id').references(() => masterLocations.id),
    externalId: text('external_id'),
    name: text('name'),

    rawAddressLine1: text('raw_address_line1').notNull(),
    rawAddressLine2: text('raw_address_line2'),
    rawSuburb: text('raw_suburb'),
    rawCity: text('raw_city').notNull(),
    rawState: text('raw_state'),
    rawPostalCode: text('raw_postal_code'),
    rawCountry: text('raw_country').notNull(),

    normalizedHouseNumber: text('normalized_house_number'),
    normalizedRoad: text('normalized_road'),
    normalizedSuburb: text('normalized_suburb'),
    normalizedCity: text('normalized_city'),
    normalizedState: text('normalized_state'),
    normalizedPostalCode: text('normalized_postal_code'),
    normalizedCountry: text('normalized_country'),
    addressHash: text('address_hash'),

    matchConfidence: doublePrecision('match_confidence'),
    matchMethod: text('match_method'),

    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_locations_client').on(t.clientId),
    index('idx_locations_master').on(t.masterLocationId),
    index('idx_locations_hash').on(t.addressHash),
    index('idx_locations_status').on(t.status),
    // Dedup-by-hash lookup, scoped to (client, partition).
    index('idx_locations_address_hash')
      .on(t.clientId, t.partitionId, t.addressHash)
      .where(sql`${t.addressHash} IS NOT NULL`),
    // Dedup-by-external-id lookup, partial unique to allow null externalIds.
    uniqueIndex('idx_locations_external_id')
      .on(t.clientId, t.partitionId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  ],
);

export type NewLocation = typeof locations.$inferInsert;
export type LocationRow = typeof locations.$inferSelect;
