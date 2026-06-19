/**
 * Reusable named bundles of properties scoped to a layer. The per-feature
 * property values themselves still live inline on `layer_features` as a
 * JSONB map; `property_sets` + `properties` provide a way to define the
 * canonical set of keys and seed values for a layer.
 *
 * Slice 4 lands the schema only — no aggregate, no repository, no use
 * cases. The aggregate scaffolding (and ID prefix `pst`) lands when a
 * use case actually needs to manage property sets, mirroring how
 * `location_attributes` was treated in Slice 3.
 */
import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { layers } from './layers.js';

export const propertySets = pgTable(
  'property_sets',
  {
    id: text('id').primaryKey(),
    layerId: text('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idx_property_sets_layer_name').on(t.layerId, t.name)],
);

export type NewPropertySet = typeof propertySets.$inferInsert;
export type PropertySetRow = typeof propertySets.$inferSelect;
