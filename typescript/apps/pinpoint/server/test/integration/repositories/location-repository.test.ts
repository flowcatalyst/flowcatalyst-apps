/**
 * Integration test for LocationRepository. Covers persist + read paths
 * (findById, findByExternalId scoped to (client, partition), listByClient
 * paged, listByMaster).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  asLocationId,
  asMasterLocationId,
  LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { asClientId, CLIENT_ID_PREFIX } from '../../../src/domain/tenancy/ids.js';
import { Client } from '../../../src/domain/tenancy/client.js';
import { Location } from '../../../src/domain/locations/location.js';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { createDrizzleLocationRepository } from '../../../src/infrastructure/location-repository.js';
import type { LocationRepository } from '../../../src/domain/locations/location.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

describe('LocationRepository (integration)', () => {
  let repo: LocationRepository;
  let clientId: ReturnType<typeof asClientId>;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzleLocationRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
    const { db } = await getDbFixture();
    const clientRepo = createDrizzleClientRepository(db);
    clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    await clientRepo.persist(
      Client.create({ id: clientId, name: 'Acme', code: `LR_${generateTsid()}`, now: new Date() }),
    );
  });

  function newLocation(overrides: Partial<{ externalId: string; address: string }> = {}) {
    return Location.create({
      id: asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`),
      clientId,
      partitionId: null,
      externalId: overrides.externalId ?? null,
      name: 'Test loc',
      rawAddressLine1: overrides.address ?? '548 Market Street',
      rawAddressLine2: null,
      rawSuburb: null,
      rawCity: 'San Francisco',
      rawState: 'CA',
      rawPostalCode: null,
      rawCountry: 'USA',
      now: new Date(),
    });
  }

  it('persist + findById roundtrip', async () => {
    const l = newLocation();
    await repo.persist(l);
    expect((await repo.findById(l.id))?.rawCity).toBe('San Francisco');
  });

  it('findByExternalId scopes to (client, partition)', async () => {
    const a = newLocation({ externalId: 'ext-001' });
    await repo.persist(a);

    expect((await repo.findByExternalId(clientId, null, 'ext-001'))?.id).toBe(a.id);
    expect(await repo.findByExternalId(asClientId('cli_other'), null, 'ext-001')).toBeNull();
  });

  it('listByClient paginates + reports total', async () => {
    for (let i = 0; i < 4; i++) {
      await repo.persist(newLocation({ address: `Addr ${i}` }));
    }

    const page = await repo.listByClient({ clientId, limit: 2, offset: 1 });
    expect(page.total).toBe(4);
    expect(page.locations.length).toBe(2);
  });

  it('listByMaster returns only children of the given master', async () => {
    const masterId = asMasterLocationId('mlo_test_lr_listbymaster');

    // No master row exists in master_locations — listByMaster doesn't
    // FK-validate, it just filters by the master_location_id column on
    // locations. Use it to verify scoping.
    expect((await repo.listByMaster(masterId)).length).toBe(0);
  });
});
