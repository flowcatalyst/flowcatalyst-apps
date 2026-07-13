import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Trips — the transport PLANNING context's aggregate (docs/
 * transport-context.md "Offer composition"): an offered/claimed stop
 * sequence over requested transport orders at one store. The trip row IS
 * the reservation record (driver + vehicle bound at offer time); member
 * orders carry the expiring hold in their `reservation` column.
 */
export const trips = pgTable(
  'trips',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    originRef: text('origin_ref').notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('offered'),
    driverRef: text('driver_ref').notNull(),
    vehicleRef: text('vehicle_ref').notNull(),
    depotRef: text('depot_ref'),
    territoryRef: text('territory_ref'),
    orderIds: jsonb('order_ids').notNull(),
    anchorOrderId: text('anchor_order_id'),
    stops: jsonb('stops').notNull(),
    offerExpiresAt: timestampColumn('offer_expires_at').notNull(),
    routeKm: doublePrecision('route_km'),
    routeMinutes: doublePrecision('route_minutes'),
    failureReason: text('failure_reason'),
    version: integer('version').notNull().default(1),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Serves listByClient AND listByDriver (status='claimed' is naturally
    // tiny — a driver holds 1–2 claimed trips; the driver filter is cheap on
    // top). idx_trips_client_store was dropped in the 2026-07 index pass:
    // nothing queries trips by origin store.
    index('idx_trips_client_status').on(t.clientId, t.status),
  ],
);

export type TripRow = typeof trips.$inferSelect;
