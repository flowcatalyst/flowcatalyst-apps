/**
 * Countries — reference data for address resolution.
 *
 * Slice 5 lands the deferred `geometry GEOMETRY(Geometry, 4326)` column
 * + GIST index alongside the PostGIS canary. The ~250-country seed lives
 * in `drizzle/seed_countries.sql` (a custom migration applied after the
 * generated schema migration) and matches the Rust `016_countries_seed.sql`
 * verbatim.
 */
import { pgTable, serial, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { geometry } from './types/geometry.js';

export const countries = pgTable(
  'countries',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    isoA2: text('iso_a2').notNull(),
    isoA3: text('iso_a3').notNull(),
    geometry: geometry('geometry'),
  },
  (t) => [
    uniqueIndex('idx_countries_iso_a3')
      .on(t.isoA3)
      .where(sql`${t.isoA3} <> '-99'`),
    uniqueIndex('idx_countries_iso_a2')
      .on(t.isoA2)
      .where(sql`${t.isoA2} <> '-99'`),
    index('idx_countries_geometry').using('gist', t.geometry),
    index('idx_countries_name').on(t.name),
  ],
);

export type NewCountry = typeof countries.$inferInsert;
export type CountryRow = typeof countries.$inferSelect;
