import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  TransactionStore,
  resolveDb,
  type TransactionContext,
} from '@flowcatalyst-apps/app-framework';
import { ConcurrencyConflictError } from '@fulfil-go/framework';
import type {
  TransportCourier,
  TransportOrder,
  TransportOrderStatus,
} from '../domain/transport-orders/transport-order.js';
import type { TransportOrderRepository } from '../domain/transport-orders/transport-order.repository.js';
import { asTransportOrderId, type TransportOrderId } from '../domain/transport-orders/ids.js';
import type { TransportParcel, TransportStop } from '../transport/provider-port.js';
import { transportOrders, type TransportOrderRow } from './schema/transport-orders.js';

function toDomain(row: TransportOrderRow): TransportOrder {
  return {
    id: asTransportOrderId(row.id),
    clientId: row.clientId,
    fulfilmentId: row.fulfilmentId,
    partId: row.partId,
    shortId: row.shortId,
    status: row.status as TransportOrderStatus,
    serviceLevel: row.serviceLevel,
    originRef: row.originRef,
    origin: row.origin as TransportStop,
    destination: row.destination as TransportStop,
    window: { slotStart: row.slotStart, slotEnd: row.slotEnd },
    parcels: row.parcels as TransportParcel[],
    requiresVehicle: row.requiresVehicle,
    provider: row.provider,
    candidateProviders: row.candidateProviders as string[],
    providerRef: row.providerRef,
    trackingUrl: row.trackingUrl,
    courier: (row.courier as TransportCourier | null) ?? null,
    failureReason: row.failureReason,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleTransportOrderRepository(
  db: PostgresJsDatabase,
): TransportOrderRepository {
  // Reads join the ambient use-case tx (ALS) — pool self-deadlock rule.
  const current = () => resolveDb(db, TransactionStore.get());

  return {
    async persist(aggregate: TransportOrder, tx?: TransactionContext): Promise<TransportOrder> {
      const client = resolveDb(db, tx);
      let row: TransportOrderRow | undefined;
      if (aggregate.version === 1) {
        [row] = await client
          .insert(transportOrders)
          .values({
            id: aggregate.id,
            clientId: aggregate.clientId,
            fulfilmentId: aggregate.fulfilmentId,
            partId: aggregate.partId,
            shortId: aggregate.shortId,
            status: aggregate.status,
            serviceLevel: aggregate.serviceLevel,
            originRef: aggregate.originRef,
            origin: aggregate.origin,
            destination: aggregate.destination,
            slotStart: aggregate.window.slotStart,
            slotEnd: aggregate.window.slotEnd,
            parcels: aggregate.parcels,
            requiresVehicle: aggregate.requiresVehicle,
            provider: aggregate.provider,
            candidateProviders: aggregate.candidateProviders,
            providerRef: aggregate.providerRef,
            trackingUrl: aggregate.trackingUrl,
            courier: aggregate.courier,
            failureReason: aggregate.failureReason,
            version: aggregate.version,
            createdAt: aggregate.createdAt,
            updatedAt: aggregate.updatedAt,
          })
          .returning();
      } else {
        // Optimistic locking (house rule): guard on the prior version.
        // Captured request data is immutable; only process state changes.
        [row] = await client
          .update(transportOrders)
          .set({
            status: aggregate.status,
            provider: aggregate.provider,
            providerRef: aggregate.providerRef,
            trackingUrl: aggregate.trackingUrl,
            courier: aggregate.courier,
            failureReason: aggregate.failureReason,
            version: aggregate.version,
            updatedAt: aggregate.updatedAt,
          })
          .where(
            and(
              eq(transportOrders.id, aggregate.id),
              eq(transportOrders.version, aggregate.version - 1),
            ),
          )
          .returning();
        if (!row) {
          throw new ConcurrencyConflictError('TransportOrder', aggregate.id, aggregate.version - 1);
        }
      }
      if (!row) throw new Error(`TransportOrder persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: TransportOrder, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client
        .delete(transportOrders)
        .where(eq(transportOrders.id, aggregate.id))
        .returning();
      return rows.length > 0;
    },

    async findById(clientId: string, id: TransportOrderId): Promise<TransportOrder | null> {
      const [row] = await current()
        .select()
        .from(transportOrders)
        .where(and(eq(transportOrders.id, id), eq(transportOrders.clientId, clientId)))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByFulfilment(clientId: string, fulfilmentId: string) {
      const rows = await current()
        .select()
        .from(transportOrders)
        .where(
          and(
            eq(transportOrders.clientId, clientId),
            eq(transportOrders.fulfilmentId, fulfilmentId),
          ),
        )
        .orderBy(transportOrders.shortId);
      return rows.map(toDomain);
    },

    async findByProviderRef(provider: string, providerRef: string) {
      const [row] = await current()
        .select()
        .from(transportOrders)
        .where(
          and(
            eq(transportOrders.provider, provider),
            eq(transportOrders.providerRef, providerRef),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByClient(clientId, limit, offset, statuses) {
      const conditions = [eq(transportOrders.clientId, clientId)];
      if (statuses && statuses.length > 0) {
        conditions.push(inArray(transportOrders.status, [...statuses]));
      }
      const rows = await current()
        .select()
        .from(transportOrders)
        .where(and(...conditions))
        .orderBy(desc(transportOrders.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(toDomain);
    },

    async listRequestedByStore(clientId, originRef, providers) {
      if (providers.length === 0) return [];
      const rows = await current()
        .select()
        .from(transportOrders)
        .where(
          and(
            eq(transportOrders.clientId, clientId),
            eq(transportOrders.originRef, originRef),
            eq(transportOrders.status, 'requested'),
            inArray(transportOrders.provider, [...providers]),
          ),
        )
        .orderBy(transportOrders.slotStart);
      return rows.map(toDomain);
    },
  };
}
