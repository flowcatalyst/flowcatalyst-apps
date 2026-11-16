import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { containsPattern } from './search-pattern.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import {
  asClientId,
  asPartitionId,
  type ClientId,
  type PartitionId,
} from '../domain/tenancy/ids.js';
import { asLocationId, asMasterLocationId, type LocationId } from '../domain/locations/ids.js';
import type {
  CaptureReview,
  Location,
  LocationGeocodeSource,
  LocationStatus,
  MatchMethod,
} from '../domain/locations/location.js';
import type {
  ListByClientQuery,
  ListByClientResult,
  LocationRepository,
  ReviewQueueQuery,
} from '../domain/locations/location.repository.js';
import { locations, locationSearchText, type LocationRow } from './schema/locations.js';

function toDomain(row: LocationRow): Location {
  return {
    id: asLocationId(row.id),
    clientId: asClientId(row.clientId),
    partitionId: row.partitionId ? asPartitionId(row.partitionId) : null,
    sourceMasterLocationId: row.sourceMasterLocationId
      ? asMasterLocationId(row.sourceMasterLocationId)
      : null,
    externalId: row.externalId,
    name: row.name,
    rawAddressLine1: row.rawAddressLine1,
    matchAddress: row.matchAddress,
    rawAddressLine2: row.rawAddressLine2,
    rawSuburb: row.rawSuburb,
    rawCity: row.rawCity,
    rawState: row.rawState,
    rawPostalCode: row.rawPostalCode,
    rawCountry: row.rawCountry,
    normalizedHouseNumber: row.normalizedHouseNumber,
    normalizedRoad: row.normalizedRoad,
    normalizedSuburb: row.normalizedSuburb,
    normalizedCity: row.normalizedCity,
    normalizedState: row.normalizedState,
    normalizedPostalCode: row.normalizedPostalCode,
    normalizedCountry: row.normalizedCountry,
    addressHash: row.addressHash,
    matchConfidence: row.matchConfidence,
    matchMethod: row.matchMethod as MatchMethod | null,
    latitude: row.latitude,
    longitude: row.longitude,
    geocodeSource: row.geocodeSource as LocationGeocodeSource | null,
    geocodeConfidence: row.geocodeConfidence,
    geocodeRoadMatched: row.geocodeRoadMatched,
    geocodeExpiresAt: row.geocodeExpiresAt,
    geocodedAt: row.geocodedAt,
    validatedAt: row.validatedAt,
    captureMasterLocationId: row.captureMasterLocationId
      ? asMasterLocationId(row.captureMasterLocationId)
      : null,
    captureDistanceM: row.captureDistanceM,
    captureReview: row.captureReview as CaptureReview | null,
    status: row.status as LocationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Columns a persist may change after creation (everything but identity + received address). */
function mutable(aggregate: Location, point: SQL) {
  return {
    sourceMasterLocationId: aggregate.sourceMasterLocationId,
    externalId: aggregate.externalId,
    name: aggregate.name,
    matchAddress: aggregate.matchAddress,
    normalizedHouseNumber: aggregate.normalizedHouseNumber,
    normalizedRoad: aggregate.normalizedRoad,
    normalizedSuburb: aggregate.normalizedSuburb,
    normalizedCity: aggregate.normalizedCity,
    normalizedState: aggregate.normalizedState,
    normalizedPostalCode: aggregate.normalizedPostalCode,
    normalizedCountry: aggregate.normalizedCountry,
    addressHash: aggregate.addressHash,
    matchConfidence: aggregate.matchConfidence,
    matchMethod: aggregate.matchMethod,
    latitude: aggregate.latitude,
    longitude: aggregate.longitude,
    point: point as never,
    geocodeSource: aggregate.geocodeSource,
    geocodeConfidence: aggregate.geocodeConfidence,
    geocodeRoadMatched: aggregate.geocodeRoadMatched,
    geocodeExpiresAt: aggregate.geocodeExpiresAt,
    geocodedAt: aggregate.geocodedAt,
    validatedAt: aggregate.validatedAt,
    captureMasterLocationId: aggregate.captureMasterLocationId,
    captureDistanceM: aggregate.captureDistanceM,
    captureReview: aggregate.captureReview,
    status: aggregate.status,
    updatedAt: aggregate.updatedAt,
  };
}

function partitionCondition(partitionId: PartitionId | null | undefined): SQL | undefined {
  if (partitionId === undefined) return undefined;
  return partitionId === null ? isNull(locations.partitionId) : eq(locations.partitionId, partitionId);
}

/**
 * Drizzle repository for locations. The `point` geometry is written through a
 * raw `ST_MakePoint` fragment (see master-location-repository.ts and
 * docs/spatial-queries.md).
 */
export function createDrizzleLocationRepository(db: PostgresJsDatabase): LocationRepository {
  return {
    async persist(aggregate: Location, tx?: TransactionContext): Promise<Location> {
      const client = resolveDb(db, tx);
      const point =
        aggregate.latitude !== null && aggregate.longitude !== null
          ? sql`ST_SetSRID(ST_MakePoint(${aggregate.longitude}::double precision, ${aggregate.latitude}::double precision), 4326)`
          : sql`NULL::geometry`;
      const [row] = await client
        .insert(locations)
        .values({
          id: aggregate.id,
          clientId: aggregate.clientId,
          partitionId: aggregate.partitionId,
          rawAddressLine1: aggregate.rawAddressLine1,
          rawAddressLine2: aggregate.rawAddressLine2,
          rawSuburb: aggregate.rawSuburb,
          rawCity: aggregate.rawCity,
          rawState: aggregate.rawState,
          rawPostalCode: aggregate.rawPostalCode,
          rawCountry: aggregate.rawCountry,
          createdAt: aggregate.createdAt,
          ...mutable(aggregate, point),
        })
        .onConflictDoUpdate({ target: locations.id, set: mutable(aggregate, point) })
        .returning();

      if (!row) throw new Error(`Location persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: Location, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client.delete(locations).where(eq(locations.id, aggregate.id)).returning();
      return rows.length > 0;
    },

    async findById(id: LocationId): Promise<Location | null> {
      const [row] = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
      return row ? toDomain(row) : null;
    },

    async findByExternalId(
      clientId: ClientId,
      partitionId: PartitionId | null,
      externalId: string,
    ): Promise<Location | null> {
      const [row] = await db
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.clientId, clientId),
            partitionCondition(partitionId),
            eq(locations.externalId, externalId),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async findByHash(clientId, partitionId, addressHash): Promise<Location | null> {
      const [row] = await db
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.clientId, clientId),
            partitionCondition(partitionId),
            eq(locations.addressHash, addressHash),
          ),
        )
        .orderBy(asc(locations.createdAt))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async findFuzzyCandidates(
      clientId,
      partitionId,
      addressLine,
      threshold,
      limit,
    ): Promise<readonly Location[]> {
      // Same expression as idx_locations_match_address_trgm.
      const similarity = sql`similarity(lower(${locations.matchAddress}), ${addressLine.toLowerCase()})`;
      const rows = await db
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.clientId, clientId),
            partitionCondition(partitionId),
            sql`${similarity} >= ${threshold}`,
          ),
        )
        .orderBy(desc(similarity))
        .limit(limit);
      return rows.map(toDomain);
    },

    async listBySourceMaster(masterLocationId): Promise<readonly Location[]> {
      const rows = await db
        .select()
        .from(locations)
        .where(eq(locations.sourceMasterLocationId, masterLocationId))
        .orderBy(asc(locations.createdAt));
      return rows.map(toDomain);
    },

    async listByClient(query: ListByClientQuery): Promise<ListByClientResult> {
      const search = query.search?.trim();
      const pattern = search ? containsPattern(search) : null;
      const where = and(
        eq(locations.clientId, query.clientId),
        query.partitionId ? eq(locations.partitionId, query.partitionId) : undefined,
        query.status ? eq(locations.status, query.status) : undefined,
        // Same expression as idx_locations_search_trgm → index-backed ILIKE.
        pattern ? sql`${locationSearchText(locations)} ILIKE ${pattern}` : undefined,
      );
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(locations)
          .where(where)
          .orderBy(asc(locations.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(locations).where(where),
      ]);
      return {
        locations: rows.map(toDomain),
        total: Number(totalRow[0]?.value ?? 0),
      };
    },

    async listByStatus(status, limit): Promise<readonly Location[]> {
      const rows = await db
        .select()
        .from(locations)
        .where(eq(locations.status, status))
        .orderBy(asc(locations.createdAt))
        .limit(limit);
      return rows.map(toDomain);
    },

    async listGeocodesExpiringBefore(cutoff, limit): Promise<readonly Location[]> {
      const rows = await db
        .select()
        .from(locations)
        .where(and(isNotNull(locations.geocodeExpiresAt), lt(locations.geocodeExpiresAt, cutoff)))
        .orderBy(asc(locations.geocodeExpiresAt))
        .limit(limit);
      return rows.map(toDomain);
    },

    async listReviewQueue(query: ReviewQueueQuery) {
      const reasons: Record<NonNullable<ReviewQueueQuery['reason']>, SQL> = {
        PENDING: eq(locations.status, 'PENDING'),
        GEOCODED: eq(locations.status, 'GEOCODED'),
        CAPTURE_DISAGREES: eq(locations.captureReview, 'DISAGREES'),
      };
      const reason = query.reason ? reasons[query.reason] : or(...Object.values(reasons));
      const where = and(
        reason,
        query.clientIds?.length
          ? inArray(locations.clientId, [...query.clientIds])
          : undefined,
        query.partitionIds?.length
          ? inArray(locations.partitionId, [...query.partitionIds])
          : undefined,
        query.visibleTo ? visibility(query.visibleTo) : undefined,
      );
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(locations)
          .where(where)
          .orderBy(asc(locations.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(locations).where(where),
      ]);
      return { locations: rows.map(toDomain), total: Number(totalRow[0]?.value ?? 0) };
    },

    async count(): Promise<number> {
      const [row] = await db.select({ value: count() }).from(locations);
      return Number(row?.value ?? 0);
    },
  };
}

/** Granted partitions, plus partition-less locations of the granted clients. */
function visibility(to: NonNullable<ReviewQueueQuery['visibleTo']>): SQL {
  const visible: SQL[] = [];
  if (to.partitionIds.length > 0) visible.push(inArray(locations.partitionId, [...to.partitionIds]));
  if (to.clientIds.length > 0) {
    visible.push(and(isNull(locations.partitionId), inArray(locations.clientId, [...to.clientIds]))!);
  }
  return visible.length > 0 ? or(...visible)! : sql`false`;
}
