import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Transport orders — the transport context's request-side aggregate
 * (docs/transport-context.md). One per picked fulfilment part (v1);
 * (client_id, part_id) is the request idempotency backstop. provider_ref
 * correlates provider webhooks back to the order.
 */
export const transportOrders = pgTable(
  'transport_orders',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    fulfilmentId: text('fulfilment_id').notNull(),
    partId: text('part_id').notNull(),
    shortId: text('short_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('requested'),
    serviceLevel: varchar('service_level', { length: 16 }).notNull(),
    originRef: text('origin_ref').notNull(),
    origin: jsonb('origin').notNull(),
    destination: jsonb('destination').notNull(),
    slotStart: timestampColumn('slot_start').notNull(),
    slotEnd: timestampColumn('slot_end').notNull(),
    parcels: jsonb('parcels').notNull(),
    requiresVehicle: boolean('requires_vehicle').notNull().default(false),
    provider: varchar('provider', { length: 32 }).notNull(),
    candidateProviders: jsonb('candidate_providers').notNull(),
    providerRef: text('provider_ref'),
    trackingUrl: text('tracking_url'),
    courier: jsonb('courier'),
    failureReason: text('failure_reason'),
    // Planning-marketplace hold: {tripId, driverRef, vehicleRef, expiresAt}.
    // Expiry frees the order implicitly — no sweeper touches this column.
    reservation: jsonb('reservation'),
    version: integer('version').notNull().default(1),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_transport_orders_client_part').on(t.clientId, t.partId),
    index('idx_transport_orders_client_status').on(t.clientId, t.status),
    index('idx_transport_orders_fulfilment').on(t.clientId, t.fulfilmentId),
    index('idx_transport_orders_provider_ref').on(t.provider, t.providerRef),
    // Planning marketplace feed: requested work at a store, slot order.
    // PARTIAL on the only status the feed ever reads (2026-07 index pass):
    // orders drop out on booking/claim, keeping the driver-poll index tiny
    // while the 5-transition order lifecycle skips it entirely once past
    // 'requested'. findRequestedByFulfilmentExternalRef rides it too.
    index('idx_transport_orders_store_status')
      .on(t.clientId, t.originRef, t.slotStart)
      .where(sql`status = 'requested'`),
  ],
);

export type TransportOrderRow = typeof transportOrders.$inferSelect;

/**
 * Timed process reactions (the LastMileFulfilment bookkeeping pattern):
 * a reaction the process manager decided to take LATER — first consumer is
 * the STANDARD service-level transport request (slotStart − lead). The
 * sweep releases due rows; unique (kind, fulfilment_id) makes scheduling
 * idempotent under webhook replays.
 */
export const processReactions = pgTable(
  'process_reactions',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    fulfilmentId: text('fulfilment_id').notNull(),
    kind: varchar('kind', { length: 40 }).notNull(),
    dueAt: timestampColumn('due_at').notNull(),
    status: varchar('status', { length: 12 }).notNull().default('pending'),
    payload: jsonb('payload'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_process_reactions_kind_fulfilment').on(t.kind, t.fulfilmentId),
    index('idx_process_reactions_due').on(t.status, t.dueAt),
  ],
);

export type ProcessReactionRow = typeof processReactions.$inferSelect;
