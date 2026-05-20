/**
 * location_feature_associations — join table from Rust migration 011 plus
 * the `distance_meters` column added by migration 013.
 *
 * Populated by the spatial-matching pipeline: for every location that
 * matches a layer's boundary (RADIUS/POLYGON containment) or is the
 * nearest active POINT feature on a layer, an association row records
 * the link. `distance_meters` is non-null only for POINT matches.
 *
 * Slice 5 ports the schema (no FK back to master_locations needed at
 * this layer — the association is via locations). Populating rows
 * happens inside the matching pipeline, which is layered on top of
 * spatial-lookup in later slices.
 */
import { doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { locations } from './locations.js';
import { layers } from './layers.js';
import { layerFeatures } from './layer-features.js';

export const locationFeatureAssociations = pgTable(
  'location_feature_associations',
  {
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    layerFeatureId: text('layer_feature_id')
      .notNull()
      .references(() => layerFeatures.id, { onDelete: 'cascade' }),
    layerId: text('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    distanceMeters: doublePrecision('distance_meters'),
    associatedAt: timestampColumn('associated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.locationId, t.layerFeatureId] }),
    index('idx_lfa_location').on(t.locationId),
    index('idx_lfa_feature').on(t.layerFeatureId),
    index('idx_lfa_layer').on(t.layerId),
  ],
);

export type NewLocationFeatureAssociation = typeof locationFeatureAssociations.$inferInsert;
export type LocationFeatureAssociationRow = typeof locationFeatureAssociations.$inferSelect;
