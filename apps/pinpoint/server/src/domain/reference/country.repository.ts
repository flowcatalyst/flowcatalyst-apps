import type { Country } from './country.js';

export interface CountryRepository {
  listAll(): Promise<readonly Country[]>;
  findByIsoA2(isoA2: string): Promise<Country | null>;
  findByIsoA3(isoA3: string): Promise<Country | null>;
}

