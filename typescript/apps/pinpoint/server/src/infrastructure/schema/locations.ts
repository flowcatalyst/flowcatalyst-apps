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
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { clients } from './clients.js';
import { partitions } from './partitions.js';
import { geometry } from './types/geometry.js';

export const locations = pgTable(
  'locations',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    partitionId: text('partition_id').references(() => partitions.id),
    /**
     * The master location this location's data was copied from, if it matched
     * one. A reference only — no FK: masters are reference data, not parents.
     */
    sourceMasterLocationId: text('source_master_location_id'),
    externalId: text('external_id'),
    name: text('name'),

    rawAddressLine1: text('raw_address_line1').notNull(),
    // The editable "match address": initialised to the received address
    // (raw_address_line1) but drives all normalization + matching. Editing it +
    // re-running matching is the rematch-location flow. raw_address_line1 stays
    // the immutable "received address".
    matchAddress: text('match_address').notNull(),
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

    /** The location's own coordinates (point written via ST_MakePoint, see master-locations). */
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    point: geometry('point'),
    /** MASTER_LOCATIONS | PHOTON | GOOGLE_MAPS | OPERATOR. */
    geocodeSource: varchar('geocode_source', { length: 20 }),
    geocodeConfidence: doublePrecision('geocode_confidence'),
    geocodeRoadMatched: boolean('geocode_road_matched'),
    /** Cached third-party (Google) coordinates must be refreshed or dropped by then. */
    geocodeExpiresAt: timestampColumn('geocode_expires_at'),
    geocodedAt: timestampColumn('geocoded_at'),
    validatedAt: timestampColumn('validated_at'),

    /** A delivery capture that disagreed with these coordinates (DRAFT master + distance). */
    captureMasterLocationId: text('capture_master_location_id'),
    captureDistanceM: doublePrecision('capture_distance_m'),
    captureReview: varchar('capture_review', { length: 20 }),

    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_locations_client').on(t.clientId),
    index('idx_locations_source_master').on(t.sourceMasterLocationId),
    index('idx_locations_point').using('gist', t.point),
    index('idx_locations_geocode_expires')
      .on(t.geocodeExpiresAt)
      .where(sql`${t.geocodeExpiresAt} IS NOT NULL`),
    // Fuzzy lookup of a client's locations by address (delivery capture).
    index('idx_locations_match_address_trgm').using(
      'gist',
      sql`lower(${t.matchAddress}) gist_trgm_ops`,
    ),
    index('idx_locations_hash').on(t.addressHash),
    index('idx_locations_status').on(t.status),
    // Free-text search (BFF `q`) — see `locationSearchText` below.
    index('idx_locations_search_trgm').using('gin', sql`(${locationSearchText(t)}) gin_trgm_ops`),
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

/**
 * The searchable text of a location — name, external id, raw address line,
 * suburb, city, postal code. MUST stay identical to the expression indexed by
 * `idx_locations_search_trgm` (Postgres only uses an expression index when the
 * query expression matches exactly); the repository's `listByClient` search
 * filter is `locationSearchText(locations) ILIKE '%…%'`.
 */
export function locationSearchText(t: {
  name: AnyPgColumn;
  externalId: AnyPgColumn;
  rawAddressLine1: AnyPgColumn;
  rawSuburb: AnyPgColumn;
  rawCity: AnyPgColumn;
  rawPostalCode: AnyPgColumn;
}): SQL {
  return sql`coalesce(${t.name}, '') || ' ' || coalesce(${t.externalId}, '') || ' ' || ${t.rawAddressLine1} || ' ' || coalesce(${t.rawSuburb}, '') || ' ' || ${t.rawCity} || ' ' || coalesce(${t.rawPostalCode}, '')`;
}
