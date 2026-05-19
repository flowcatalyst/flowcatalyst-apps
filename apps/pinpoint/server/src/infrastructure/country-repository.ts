import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Country } from '../domain/reference/country.js';
import type { CountryRepository } from '../domain/reference/country.repository.js';
import { countries, type CountryRow } from './schema/countries.js';

function toDomain(row: CountryRow): Country {
  return {
    id: row.id,
    name: row.name,
    isoA2: row.isoA2,
    isoA3: row.isoA3,
  };
}

export function createDrizzleCountryRepository(db: PostgresJsDatabase): CountryRepository {
  return {
    async listAll(): Promise<readonly Country[]> {
      const rows = await db.select().from(countries).orderBy(asc(countries.name));
      return rows.map(toDomain);
    },

    async findByIsoA2(isoA2: string): Promise<Country | null> {
      const [row] = await db.select().from(countries).where(eq(countries.isoA2, isoA2)).limit(1);
      return row ? toDomain(row) : null;
    },

    async findByIsoA3(isoA3: string): Promise<Country | null> {
      const [row] = await db.select().from(countries).where(eq(countries.isoA3, isoA3)).limit(1);
      return row ? toDomain(row) : null;
    },
  };
}
