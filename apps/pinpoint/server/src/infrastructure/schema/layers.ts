/**
 * Layers — partitioned regions used to overlay business meaning onto
 * resolved locations (sales territories, delivery zones, GeoFenced areas).
 *
 * Slice 5 lands the deferred `boundary GEOMETRY(Geometry, 4326)` column
 * + GIST index alongside the PostGIS canary. The Rust spatial pipeline
 * keeps both forms: scalar lat/lon/radius/polygon_geojson (for API
 * round-tripping) and the precomputed `boundary` geometry (for spatial
 * predicates). Backfill from scalar to geometry lives in the Rust
 * migration 011; we don't replicate the backfill in TS because layers
 * created via the Slice 4 API never had scalar-only state stored.
 *
 * Includes migration 010 (`code` column with unique index per client) and
 * is the parent table for layer_features, property_sets, layer_partitions,
 * and location_layer_associations.
 */
import { doublePrecision, pgTable, text, uniqueIndex, varchar, index } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { clients } from './clients.js';
import { geometry } from './types/geometry.js';

export const layers = pgTable(
  'layers',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    layerType: text('layer_type').notNull(),
    centerLat: doublePrecision('center_lat'),
    centerLon: doublePrecision('center_lon'),
    radiusMeters: doublePrecision('radius_meters'),
    polygonGeojson: text('polygon_geojson'),
    boundary: geometry('boundary'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_layers_client').on(t.clientId),
    uniqueIndex('idx_layers_client_code').on(t.clientId, t.code),
    index('idx_layers_boundary').using('gist', t.boundary),
  ],
);

export type NewLayer = typeof layers.$inferInsert;
export type LayerRow = typeof layers.$inferSelect;
