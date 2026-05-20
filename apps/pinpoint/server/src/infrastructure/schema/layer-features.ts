/**
 * Layer features — addressable subregions of a layer (individual stores
 * within a sales territory, polygons within a zone, points along a route).
 *
 * Slice 5 lands the deferred `boundary GEOMETRY(Geometry, 4326)` column
 * + GIST index alongside the PostGIS canary. Spatial predicates in
 * `spatial-lookup` query against `boundary` directly; scalar lat/lon/
 * radius/polygon_geojson stay for round-tripping.
 *
 * `property_values` is the inline per-feature value bag (max 6 keys, enforced
 * at the use-case layer to match Rust). It's a flat JSONB map rather than a
 * normalized table since values are small, finite, and read together with
 * the feature.
 */
import { doublePrecision, index, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { layers } from './layers.js';
import { geometry } from './types/geometry.js';

export const layerFeatures = pgTable(
  'layer_features',
  {
    id: text('id').primaryKey(),
    layerId: text('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    centerLat: doublePrecision('center_lat'),
    centerLon: doublePrecision('center_lon'),
    radiusMeters: doublePrecision('radius_meters'),
    polygonGeojson: text('polygon_geojson'),
    boundary: geometry('boundary'),
    propertyValues: jsonb('property_values').notNull().default({}),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_layer_features_layer').on(t.layerId),
    index('idx_layer_features_status').on(t.status),
    index('idx_layer_features_boundary').using('gist', t.boundary),
  ],
);

export type NewLayerFeature = typeof layerFeatures.$inferInsert;
export type LayerFeatureRow = typeof layerFeatures.$inferSelect;
