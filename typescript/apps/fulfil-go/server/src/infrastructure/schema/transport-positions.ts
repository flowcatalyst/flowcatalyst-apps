import { doublePrecision, index, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Unified LATEST-per-vehicle position store (docs/transport-context.md
 * "Positions + map"): one row per (client, execution system, vehicle),
 * upserted on every fix — the vehicle map's read model. History stays in
 * the source streams (telemetry_locations for our app; provider webhooks
 * are transient) — this table answers "where is everything RIGHT NOW".
 *
 * client_id is NULLABLE: our execution app's telemetry is principal-keyed
 * and carries no tenant until the app binds to the marketplace (task:
 * planning context) — clientless rows render for every client in dev.
 */
export const transportPositions = pgTable(
  'transport_positions',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id'),
    /** Execution system / provider: 'own' | 'epod' | 'uber'. */
    executionSystem: varchar('execution_system', { length: 32 }).notNull(),
    /** Stable per-system vehicle key (driver principal, courier ref, reg). */
    vehicleRef: text('vehicle_ref').notNull(),
    /** Display name when the source carries one (courier name, driver). */
    label: text('label'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    heading: doublePrecision('heading'),
    speed: doublePrecision('speed'),
    recordedAt: timestampColumn('recorded_at').notNull(),
    /** Active trip/order correlation when known (uber delivery, trip ref). */
    tripRef: text('trip_ref'),
    meta: jsonb('meta'),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_transport_positions_vehicle').on(t.executionSystem, t.vehicleRef),
    index('idx_transport_positions_client').on(t.clientId, t.recordedAt),
  ],
);

export type TransportPositionRow = typeof transportPositions.$inferSelect;
