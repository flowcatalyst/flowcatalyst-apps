import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  TransactionStore,
  resolveDb,
  type TransactionContext,
} from '@flowcatalyst-apps/app-framework';
import { ConcurrencyConflictError } from '@fulfil-go/framework';
import type { Trip, TripStatus, TripStop } from '../domain/trips/trip.js';
import type { TripRepository } from '../domain/trips/trip.repository.js';
import { asTripId, type TripId } from '../domain/trips/ids.js';
import { trips, type TripRow } from './schema/trips.js';

function toDomain(row: TripRow): Trip {
  return {
    id: asTripId(row.id),
    clientId: row.clientId,
    originRef: row.originRef,
    provider: row.provider,
    status: row.status as TripStatus,
    driverRef: row.driverRef,
    vehicleRef: row.vehicleRef,
    depotRef: row.depotRef,
    territoryRef: row.territoryRef,
    orderIds: row.orderIds as string[],
    anchorOrderId: row.anchorOrderId,
    stops: row.stops as TripStop[],
    offerExpiresAt: row.offerExpiresAt,
    routeKm: row.routeKm,
    routeMinutes: row.routeMinutes,
    failureReason: row.failureReason,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleTripRepository(db: PostgresJsDatabase): TripRepository {
  // Reads join the ambient use-case tx (ALS) — pool self-deadlock rule.
  const current = () => resolveDb(db, TransactionStore.get());

  return {
    async persist(aggregate: Trip, tx?: TransactionContext): Promise<Trip> {
      const client = resolveDb(db, tx);
      let row: TripRow | undefined;
      if (aggregate.version === 1) {
        [row] = await client
          .insert(trips)
          .values({
            id: aggregate.id,
            clientId: aggregate.clientId,
            originRef: aggregate.originRef,
            provider: aggregate.provider,
            status: aggregate.status,
            driverRef: aggregate.driverRef,
            vehicleRef: aggregate.vehicleRef,
            depotRef: aggregate.depotRef,
            territoryRef: aggregate.territoryRef,
            orderIds: aggregate.orderIds,
            anchorOrderId: aggregate.anchorOrderId,
            stops: aggregate.stops,
            offerExpiresAt: aggregate.offerExpiresAt,
            routeKm: aggregate.routeKm,
            routeMinutes: aggregate.routeMinutes,
            failureReason: aggregate.failureReason,
            version: aggregate.version,
            createdAt: aggregate.createdAt,
            updatedAt: aggregate.updatedAt,
          })
          .returning();
      } else {
        // Optimistic locking (house rule): guard on the prior version. The
        // composed offer (orders/stops) is immutable; only status moves.
        [row] = await client
          .update(trips)
          .set({
            status: aggregate.status,
            failureReason: aggregate.failureReason,
            version: aggregate.version,
            updatedAt: aggregate.updatedAt,
          })
          .where(and(eq(trips.id, aggregate.id), eq(trips.version, aggregate.version - 1)))
          .returning();
        if (!row) {
          throw new ConcurrencyConflictError('Trip', aggregate.id, aggregate.version - 1);
        }
      }
      if (!row) throw new Error(`Trip persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: Trip, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client.delete(trips).where(eq(trips.id, aggregate.id)).returning();
      return rows.length > 0;
    },

    async findById(clientId: string, id: TripId): Promise<Trip | null> {
      const [row] = await current()
        .select()
        .from(trips)
        .where(and(eq(trips.id, id), eq(trips.clientId, clientId)))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByClient(clientId, limit, offset, statuses) {
      const conditions = [eq(trips.clientId, clientId)];
      if (statuses && statuses.length > 0) {
        conditions.push(inArray(trips.status, [...statuses]));
      }
      const rows = await current()
        .select()
        .from(trips)
        .where(and(...conditions))
        .orderBy(desc(trips.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(toDomain);
    },
  };
}
