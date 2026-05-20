/**
 * Layers — partitioned regions used to overlay business meaning onto
 * resolved locations (sales territories, delivery zones, GeoFenced areas).
 *
 * Slice 4 lands the core layer schema (raw + scalar geo + status). The
 * `boundary GEOMETRY(Geometry, 4326)` column + GIST index from migrations
 * 005/009 is deferred to Slice 5 (the PostGIS canary) so we don't carry
 * the extension dependency before spatial work actually exists. Until
 * then, geometry stays in scalar form: lat/lon/radius for radius layers,
 * `polygon_geojson` text for polygon layers, and nothing for point layers.
 *
 * Includes migration 010 (`code` column with unique index per client) and
 * is the parent table for layer_features, property_sets, layer_partitions,
 * and location_layer_associations.
 */
import { doublePrecision, pgTable, text, uniqueIndex, varchar, index } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { clients } from './clients.js';

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
    /** boundary GEOMETRY(Geometry, 4326) + GIST index → Slice 5 (PostGIS canary). */
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_layers_client').on(t.clientId),
    uniqueIndex('idx_layers_client_code').on(t.clientId, t.code),
  ],
);

export type NewLayer = typeof layers.$inferInsert;
export type LayerRow = typeof layers.$inferSelect;
