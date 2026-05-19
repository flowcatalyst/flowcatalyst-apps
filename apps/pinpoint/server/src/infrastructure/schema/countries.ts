/**
 * Countries — reference data for address resolution.
 *
 * The PostGIS geometry column + GIST index land in Slice 5 alongside the
 * extension enable. Seed data (~250 countries with multipolygons, ~390KB
 * of `ST_GeomFromText` inserts in the Rust source) also defers there.
 */
import { pgTable, serial, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const countries = pgTable(
  'countries',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    isoA2: text('iso_a2').notNull(),
    isoA3: text('iso_a3').notNull(),
  },
  (t) => [
    uniqueIndex('idx_countries_iso_a3').on(t.isoA3).where(sql`${t.isoA3} <> '-99'`),
    uniqueIndex('idx_countries_iso_a2').on(t.isoA2).where(sql`${t.isoA2} <> '-99'`),
    index('idx_countries_name').on(t.name),
  ],
);

export type NewCountry = typeof countries.$inferInsert;
export type CountryRow = typeof countries.$inferSelect;
