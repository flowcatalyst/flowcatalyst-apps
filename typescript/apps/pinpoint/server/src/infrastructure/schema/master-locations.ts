/**
 * Master locations — canonical, deduplicated address records that
 * `locations` rows match against. The fan-out shape is:
 *   raw `locations` rows  →  one canonical `master_locations` row
 *
 * Lifecycle: PENDING (just normalized) → GEOCODED (lat/lon resolved by
 * `validate-master-location`) → VALIDATED (confirmed canonical by
 * `confirm-master-location`, cascades LocationValidated to children).
 *
 * Schema combines the Rust migrations:
 *  - 004 base table
 *  - 011 `point GEOMETRY(Point, 4326)` + GIST index
 *  - 012 `normalized_address_line` + pg_trgm GIST index
 *  - 014 `normalized_suburb` column
 *
 * Indexes:
 *  - idx_master_locations_client       client_id BTREE
 *  - idx_master_locations_hash         address_hash BTREE (exact-match lookup)
 *  - idx_master_locations_status       status BTREE (worker filtering)
 *  - idx_master_locations_point        point GIST (spatial joins)
 *  - idx_master_locations_address_trgm normalized_address_line GIST gist_trgm_ops
 *    (fuzzy candidate search via `pg_trgm` similarity, partial on
 *    `normalized_address_line IS NOT NULL`)
 */
import { doublePrecision, index, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { clients } from './clients.js';
import { partitions } from './partitions.js';
import { geometry } from './types/geometry.js';

export const masterLocations = pgTable(
  'master_locations',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    partitionId: text('partition_id').references(() => partitions.id),

    normalizedHouseNumber: text('normalized_house_number'),
    normalizedRoad: text('normalized_road'),
    normalizedSuburb: text('normalized_suburb'),
    normalizedCity: text('normalized_city').notNull(),
    normalizedState: text('normalized_state'),
    normalizedPostalCode: text('normalized_postal_code'),
    normalizedCountry: text('normalized_country').notNull(),
    addressHash: text('address_hash').notNull(),
    normalizedAddressLine: text('normalized_address_line'),

    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /**
     * `point GEOMETRY(Point, 4326)` is written via `ST_SetSRID(ST_MakePoint(lon, lat), 4326)`
     * in the repository's upsert path — Drizzle can't bind a value through
     * a function call so the customType reads/writes opaque WKB text, and
     * spatial writes use raw `sql\`...\`` in the INSERT. See
     * `docs/spatial-queries.md` for the established pattern.
     */
    point: geometry('point'),

    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
    validatedAt: timestampColumn('validated_at'),
  },
  (t) => [
    index('idx_master_locations_client').on(t.clientId),
    index('idx_master_locations_hash').on(t.addressHash),
    index('idx_master_locations_status').on(t.status),
    index('idx_master_locations_point').using('gist', t.point),
    index('idx_master_locations_address_trgm')
      .using('gist', sql`${t.normalizedAddressLine} gist_trgm_ops`)
      .where(sql`${t.normalizedAddressLine} IS NOT NULL`),
  ],
);

export type NewMasterLocation = typeof masterLocations.$inferInsert;
export type MasterLocationRow = typeof masterLocations.$inferSelect;
