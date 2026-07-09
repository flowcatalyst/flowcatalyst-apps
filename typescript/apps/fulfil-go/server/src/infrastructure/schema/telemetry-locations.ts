import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  varchar,
} from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Raw driver telemetry from the Transistorsoft native uploader. High-write,
 * append-only: ingested via a plain batch insert — deliberately NOT an
 * aggregate (no outbox, no audit log, no per-row tx ceremony). `raw` keeps
 * the full uploader element so schema drift in the plugin can't lose data.
 */
export const telemetryLocations = pgTable(
  'telemetry_locations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    principalId: text('principal_id').notNull(),
    /** Client-side uuid from the plugin — dedupe key for uploader retries. */
    uuid: varchar('uuid', { length: 64 }).notNull(),
    recordedAt: timestampColumn('recorded_at').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    accuracy: doublePrecision('accuracy'),
    speed: doublePrecision('speed'),
    heading: doublePrecision('heading'),
    altitude: doublePrecision('altitude'),
    isMoving: boolean('is_moving'),
    activityType: varchar('activity_type', { length: 32 }),
    battery: jsonb('battery'),
    raw: jsonb('raw').notNull(),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_telemetry_principal_recorded').on(t.principalId, t.recordedAt)],
);

export type NewTelemetryLocation = typeof telemetryLocations.$inferInsert;
export type TelemetryLocationRow = typeof telemetryLocations.$inferSelect;
