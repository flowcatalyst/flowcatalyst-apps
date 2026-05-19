import type { Country } from './country.js';

export interface CountryRepository {
  /** All countries, sorted by name. */
  listAll(): Promise<readonly Country[]>;

  /** Lookup by ISO 3166-1 alpha-2 code (e.g. "GB", "ZA"). */
  findByIsoA2(isoA2: string): Promise<Country | null>;

  /** Lookup by ISO 3166-1 alpha-3 code (e.g. "GBR", "ZAF"). */
  findByIsoA3(isoA3: string): Promise<Country | null>;
}
