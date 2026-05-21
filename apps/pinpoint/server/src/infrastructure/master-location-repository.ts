import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import { asClientId, asPartitionId, type ClientId, type PartitionId } from '../domain/tenancy/ids.js';
import { asMasterLocationId, type MasterLocationId } from '../domain/locations/ids.js';
import type {
  MasterLocation,
  MasterLocationStatus,
} from '../domain/locations/master-location.js';
import type {
  FindUnvalidatedQuery,
  FindUnvalidatedResult,
  ListMasterLocationsQuery,
  ListMasterLocationsResult,
  MasterLocationRepository,
} from '../domain/locations/master-location.repository.js';
import { masterLocations, type MasterLocationRow } from './schema/master-locations.js';

function toDomain(row: MasterLocationRow): MasterLocation {
  return {
    id: asMasterLocationId(row.id),
    clientId: asClientId(row.clientId),
    partitionId: row.partitionId ? asPartitionId(row.partitionId) : null,
    normalizedHouseNumber: row.normalizedHouseNumber,
    normalizedRoad: row.normalizedRoad,
    normalizedSuburb: row.normalizedSuburb,
    normalizedCity: row.normalizedCity,
    normalizedState: row.normalizedState,
    normalizedPostalCode: row.normalizedPostalCode,
    normalizedCountry: row.normalizedCountry,
    addressHash: row.addressHash,
    normalizedAddressLine: row.normalizedAddressLine,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status as MasterLocationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    validatedAt: row.validatedAt,
  };
}

/**
 * Drizzle repository for master_locations. The `point` GEOMETRY column
 * is written via a raw `sql` fragment because Drizzle can't bind a
 * parameter through a PostGIS function call; reads project geometry
 * separately (the matching pipeline only needs `latitude` / `longitude`
 * for spatial lookups, which we keep as plain doubles alongside the
 * derived `point`).
 *
 * Fuzzy-candidate search uses the pg_trgm `%>` ("similar to") operator,
 * partial-indexed on `normalized_address_line IS NOT NULL`. Set the
 * pg_trgm similarity threshold per-query rather than relying on the
 * session default — Slice 5's `db:init` doesn't tune `pg_trgm.similarity_threshold`.
 */
export function createDrizzleMasterLocationRepository(
  db: PostgresJsDatabase,
): MasterLocationRepository {
  return {
    async persist(aggregate: MasterLocation, tx?: TransactionContext): Promise<MasterLocation> {
      const client = resolveDb(db, tx);
      // Point is computed inline. ST_MakePoint takes (lon, lat); we always
      // pass them in that order to keep accidents impossible. When lat/lon
      // are null (PENDING masters before geocoding), pass a typed NULL —
      // an untyped param of NULL is uninferrable inside `CASE WHEN ... END`
      // and Postgres rejects it with "could not determine data type".
      const pointExpr =
        aggregate.latitude !== null && aggregate.longitude !== null
          ? sql`ST_SetSRID(ST_MakePoint(${aggregate.longitude}::double precision, ${aggregate.latitude}::double precision), 4326)`
          : sql`NULL::geometry`;

      const [row] = await client
        .insert(masterLocations)
        .values({
          id: aggregate.id,
          clientId: aggregate.clientId,
          partitionId: aggregate.partitionId,
          normalizedHouseNumber: aggregate.normalizedHouseNumber,
          normalizedRoad: aggregate.normalizedRoad,
          normalizedSuburb: aggregate.normalizedSuburb,
          normalizedCity: aggregate.normalizedCity,
          normalizedState: aggregate.normalizedState,
          normalizedPostalCode: aggregate.normalizedPostalCode,
          normalizedCountry: aggregate.normalizedCountry,
          addressHash: aggregate.addressHash,
          normalizedAddressLine: aggregate.normalizedAddressLine,
          latitude: aggregate.latitude,
          longitude: aggregate.longitude,
          point: pointExpr as never,
          status: aggregate.status,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.updatedAt,
          validatedAt: aggregate.validatedAt,
        })
        .onConflictDoUpdate({
          target: masterLocations.id,
          set: {
            normalizedHouseNumber: aggregate.normalizedHouseNumber,
            normalizedRoad: aggregate.normalizedRoad,
            normalizedSuburb: aggregate.normalizedSuburb,
            normalizedCity: aggregate.normalizedCity,
            normalizedState: aggregate.normalizedState,
            normalizedPostalCode: aggregate.normalizedPostalCode,
            normalizedCountry: aggregate.normalizedCountry,
            addressHash: aggregate.addressHash,
            normalizedAddressLine: aggregate.normalizedAddressLine,
            latitude: aggregate.latitude,
            longitude: aggregate.longitude,
            point: pointExpr as never,
            status: aggregate.status,
            updatedAt: aggregate.updatedAt,
            validatedAt: aggregate.validatedAt,
          },
        })
        .returning();

      if (!row) throw new Error(`MasterLocation persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: MasterLocation, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client
        .delete(masterLocations)
        .where(eq(masterLocations.id, aggregate.id))
        .returning();
      return rows.length > 0;
    },

    async findById(id: MasterLocationId): Promise<MasterLocation | null> {
      const [row] = await db
        .select()
        .from(masterLocations)
        .where(eq(masterLocations.id, id))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async findByHash(
      clientId: ClientId,
      partitionId: PartitionId | null,
      addressHash: string,
    ): Promise<MasterLocation | null> {
      const partitionCond =
        partitionId === null
          ? isNull(masterLocations.partitionId)
          : eq(masterLocations.partitionId, partitionId);
      const [row] = await db
        .select()
        .from(masterLocations)
        .where(
          and(
            eq(masterLocations.clientId, clientId),
            partitionCond,
            eq(masterLocations.addressHash, addressHash),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async findFuzzyCandidates(
      clientId: ClientId,
      partitionId: PartitionId | null,
      addressLine: string,
      threshold: number,
      limit: number,
    ): Promise<readonly MasterLocation[]> {
      const partitionCond =
        partitionId === null
          ? isNull(masterLocations.partitionId)
          : eq(masterLocations.partitionId, partitionId);

      // `similarity(...)` ≥ threshold gates fuzzy candidates; ORDER BY
      // descending similarity feeds the matcher the best hits first.
      const rows = await db
        .select()
        .from(masterLocations)
        .where(
          and(
            eq(masterLocations.clientId, clientId),
            partitionCond,
            sql`${masterLocations.normalizedAddressLine} IS NOT NULL`,
            sql`similarity(${masterLocations.normalizedAddressLine}, ${addressLine}) >= ${threshold}`,
          ),
        )
        .orderBy(desc(sql`similarity(${masterLocations.normalizedAddressLine}, ${addressLine})`))
        .limit(limit);

      return rows.map(toDomain);
    },

    async listByClient(query: ListMasterLocationsQuery): Promise<ListMasterLocationsResult> {
      const where =
        query.status == null
          ? eq(masterLocations.clientId, query.clientId)
          : and(
              eq(masterLocations.clientId, query.clientId),
              eq(masterLocations.status, query.status),
            );
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(masterLocations)
          .where(where)
          .orderBy(asc(masterLocations.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(masterLocations).where(where),
      ]);
      return {
        masters: rows.map(toDomain),
        total: Number(totalRow[0]?.value ?? 0),
      };
    },

    async listByStatus(status, limit): Promise<readonly MasterLocation[]> {
      const rows = await db
        .select()
        .from(masterLocations)
        .where(eq(masterLocations.status, status))
        .orderBy(asc(masterLocations.createdAt))
        .limit(limit);
      return rows.map(toDomain);
    },

    async findUnvalidated(query: FindUnvalidatedQuery): Promise<FindUnvalidatedResult> {
      // status != 'VALIDATED' plus optional clientId / partitionId IN-clauses.
      // Mirror of Rust `find_unvalidated` in pg_master_location_repository.rs.
      const filters = [ne(masterLocations.status, 'VALIDATED')];
      if (query.clientIds != null && query.clientIds.length > 0) {
        filters.push(
          inArray(
            masterLocations.clientId,
            query.clientIds.map((id) => id as string),
          ),
        );
      }
      if (query.partitionIds != null && query.partitionIds.length > 0) {
        filters.push(
          inArray(
            masterLocations.partitionId,
            query.partitionIds.map((id) => id as string),
          ),
        );
      }
      const where = and(...filters);
      const order = query.ascending ? asc(masterLocations.id) : desc(masterLocations.id);

      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(masterLocations)
          .where(where)
          .orderBy(order)
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(masterLocations).where(where),
      ]);
      return {
        masters: rows.map(toDomain),
        total: Number(totalRow[0]?.value ?? 0),
      };
    },
  };
}
