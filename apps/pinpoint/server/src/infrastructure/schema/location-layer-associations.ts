/**
 * Layer-level spatial associations between a location and the layers it
 * falls within. Populated by the matching pipeline (Slice 5+) — Slice 4
 * lands the schema only because the FK targets (locations from Slice 3,
 * layers from Slice 4) both exist now.
 *
 * The feature-level association table (`location_feature_associations`)
 * with its `distance_meters` column ships in Slice 5 alongside the
 * spatial work that populates both.
 */
import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { locations } from './locations.js';
import { layers } from './layers.js';

export const locationLayerAssociations = pgTable(
  'location_layer_associations',
  {
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    layerId: text('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    associatedAt: timestampColumn('associated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.locationId, t.layerId] })],
);

export type NewLocationLayerAssociation = typeof locationLayerAssociations.$inferInsert;
export type LocationLayerAssociationRow = typeof locationLayerAssociations.$inferSelect;
