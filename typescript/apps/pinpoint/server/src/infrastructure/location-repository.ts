import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import {
  asClientId,
  asPartitionId,
  type ClientId,
  type PartitionId,
} from '../domain/tenancy/ids.js';
import { asLocationId, asMasterLocationId, type LocationId } from '../domain/locations/ids.js';
import type { Location, LocationStatus, MatchMethod } from '../domain/locations/location.js';
import type {
  ListByClientQuery,
  ListByClientResult,
  LocationRepository,
} from '../domain/locations/location.repository.js';
import { locations, type LocationRow } from './schema/locations.js';

function toDomain(row: LocationRow): Location {
  return {
    id: asLocationId(row.id),
    clientId: asClientId(row.clientId),
    partitionId: row.partitionId ? asPartitionId(row.partitionId) : null,
    masterLocationId: row.masterLocationId ? asMasterLocationId(row.masterLocationId) : null,
    externalId: row.externalId,
    name: row.name,
    rawAddressLine1: row.rawAddressLine1,
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
    status: row.status as LocationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleLocationRepository(db: PostgresJsDatabase): LocationRepository {
  return {
    async persist(aggregate: Location, tx?: TransactionContext): Promise<Location> {
      const client = resolveDb(db, tx);
      const [row] = await client
        .insert(locations)
        .values({
          id: aggregate.id,
          clientId: aggregate.clientId,
          partitionId: aggregate.partitionId,
          masterLocationId: aggregate.masterLocationId,
          externalId: aggregate.externalId,
          name: aggregate.name,
          rawAddressLine1: aggregate.rawAddressLine1,
          rawAddressLine2: aggregate.rawAddressLine2,
          rawSuburb: aggregate.rawSuburb,
          rawCity: aggregate.rawCity,
          rawState: aggregate.rawState,
          rawPostalCode: aggregate.rawPostalCode,
          rawCountry: aggregate.rawCountry,
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
          status: aggregate.status,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.updatedAt,
        })
        .onConflictDoUpdate({
          target: locations.id,
          set: {
            masterLocationId: aggregate.masterLocationId,
            externalId: aggregate.externalId,
            name: aggregate.name,
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
            status: aggregate.status,
            updatedAt: aggregate.updatedAt,
          },
        })
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
      const partitionCond =
        partitionId === null
          ? isNull(locations.partitionId)
          : eq(locations.partitionId, partitionId);
      const [row] = await db
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.clientId, clientId),
            partitionCond,
            eq(locations.externalId, externalId),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByMaster(masterLocationId): Promise<readonly Location[]> {
      const rows = await db
        .select()
        .from(locations)
        .where(eq(locations.masterLocationId, masterLocationId))
        .orderBy(asc(locations.createdAt));
      return rows.map(toDomain);
    },

    async listByClient(query: ListByClientQuery): Promise<ListByClientResult> {
      const where = eq(locations.clientId, query.clientId);
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
      // sql tag is imported only so re-orderings in the future can use raw
      // expressions; not used in this minimal listing path.
      void sql;
      return {
        locations: rows.map(toDomain),
        total: Number(totalRow[0]?.value ?? 0),
      };
    },
  };
}
