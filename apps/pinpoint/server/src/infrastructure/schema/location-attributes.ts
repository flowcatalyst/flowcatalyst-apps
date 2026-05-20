/**
 * Per-location key/value attributes. `value` carries either a single string
 * or an array of strings (the Rust `AttributeValue` enum), serialized as
 * JSONB to keep the schema flexible.
 *
 * Slice 3 lands the schema only — there's no aggregate or repository
 * surface for attributes yet. Attribute management arrives alongside
 * Location update use cases in a later slice.
 */
import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { locations } from './locations.js';

export const locationAttributes = pgTable(
  'location_attributes',
  {
    id: text('id').primaryKey(),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_location_attrs_location_key').on(t.locationId, t.key),
    index('idx_location_attrs_location').on(t.locationId),
  ],
);

export type NewLocationAttribute = typeof locationAttributes.$inferInsert;
export type LocationAttributeRow = typeof locationAttributes.$inferSelect;
