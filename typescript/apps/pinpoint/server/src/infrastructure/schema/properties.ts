/**
 * Per-key entries inside a property set. Schema-only in Slice 4 — see
 * the matching note on `property-sets.ts`. Aggregate scaffolding lands
 * when a use case needs to manage these directly.
 */
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { propertySets } from './property-sets.js';

export const properties = pgTable(
  'properties',
  {
    id: text('id').primaryKey(),
    propertySetId: text('property_set_id')
      .notNull()
      .references(() => propertySets.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_properties_set_key').on(t.propertySetId, t.key),
    index('idx_properties_set').on(t.propertySetId),
  ],
);

export type NewProperty = typeof properties.$inferInsert;
export type PropertyRow = typeof properties.$inferSelect;
