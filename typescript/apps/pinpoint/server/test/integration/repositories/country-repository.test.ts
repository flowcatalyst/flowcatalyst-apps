/**
 * Integration test for CountryRepository. Reads from the
 * seed_globals migration's country payload (~177 rows). Country data
 * is read-only and survives the per-test TRUNCATE because the fixture's
 * truncatable set excludes seed-only tables — verified here.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDrizzleCountryRepository } from '../../../src/infrastructure/country-repository.js';
import type { CountryRepository } from '../../../src/domain/reference/country.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

describe('CountryRepository (integration)', () => {
  let repo: CountryRepository;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzleCountryRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('listAll returns the seeded countries', async () => {
    const countries = await repo.listAll();
    // Seed ships ~177 rows. Tolerate the count drifting if the seed
    // ever expands — we just want > 100 to confirm the seed migration
    // ran inside the testcontainer.
    expect(countries.length).toBeGreaterThan(100);
  });

  it('seeded countries are filterable by ISO-A3', async () => {
    const countries = await repo.listAll();
    const usa = countries.find((c) => c.isoA3 === 'USA');
    expect(usa?.name).toBe('United States of America');
  });
});
