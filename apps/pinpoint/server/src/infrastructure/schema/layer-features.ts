/**
 * Layer features — addressable subregions of a layer (individual stores
 * within a sales territory, polygons within a zone, points along a route).
 *
 * Slice 4 lands the core schema including `status` from migration 013
 * (defaults to 'ACTIVE'; lets features be disabled without deletion).
 *
 * Deferred to Slice 5:
 *  - `boundary GEOMETRY(Geometry, 4326)` column + GIST index (PostGIS canary)
 *  - `location_feature_associations` join table + its `distance_meters`
 *    column (from migration 013's second ALTER) — both arrive with the
 *    spatial matching work in Slice 5.
 *
 * `property_values` is the inline per-feature value bag (max 6 keys, enforced
 * at the use-case layer to match Rust). It's a flat JSONB map rather than a
 * normalized table since values are small, finite, and read together with
 * the feature.
 */
import { doublePrecision, index, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { layers } from './layers.js';

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
    propertyValues: jsonb('property_values').notNull().default({}),
    /** boundary GEOMETRY(Geometry, 4326) + GIST index → Slice 5 (PostGIS canary). */
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_layer_features_layer').on(t.layerId),
    index('idx_layer_features_status').on(t.status),
  ],
);

export type NewLayerFeature = typeof layerFeatures.$inferInsert;
export type LayerFeatureRow = typeof layerFeatures.$inferSelect;
