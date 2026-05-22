/**
 * Integration test for MasterLocationRepository. Exercises persist,
 * findByHash scoped lookup, listByClient with optional status filter,
 * listByStatus batch drain, findUnvalidated cross-client view, and
 * applyConfirmedGeocode.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  asMasterLocationId,
  MASTER_LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { asClientId, CLIENT_ID_PREFIX } from '../../../src/domain/tenancy/ids.js';
import { Client } from '../../../src/domain/tenancy/client.js';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { createDrizzleMasterLocationRepository } from '../../../src/infrastructure/master-location-repository.js';
import type { MasterLocationRepository } from '../../../src/domain/locations/master-location.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

function pendingMaster(clientId: string, overrides: Partial<{ city: string; hash: string }> = {}) {
  const now = new Date();
  return MasterLocation.create({
    id: asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`),
    clientId: asClientId(clientId),
    partitionId: null,
    normalizedHouseNumber: null,
    normalizedRoad: null,
    normalizedSuburb: null,
    normalizedCity: overrides.city ?? 'Cape Town',
    normalizedState: null,
    normalizedPostalCode: null,
    normalizedCountry: 'South Africa',
    addressHash: overrides.hash ?? `hash-${generateTsid()}`,
    normalizedAddressLine: 'Cape Town, South Africa',
    now,
  });
}

describe('MasterLocationRepository (integration)', () => {
  let repo: MasterLocationRepository;
  let clientId: ReturnType<typeof asClientId>;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzleMasterLocationRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
    // Persist a fresh parent client so the FK on master_locations is
    // satisfied. ID is randomized so concurrent suites can't collide.
    const { db } = await getDbFixture();
    const clientRepo = createDrizzleClientRepository(db);
    clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    await clientRepo.persist(
      Client.create({
        id: clientId,
        name: 'MLR Test',
        code: `MLR_${generateTsid()}`,
        now: new Date(),
      }),
    );
  });

  it('persists + reads back', async () => {
    const m = pendingMaster(clientId);
    const persisted = await repo.persist(m);
    expect(persisted.id).toBe(m.id);
    expect(persisted.status).toBe('PENDING');

    const fetched = await repo.findById(m.id);
    expect(fetched?.normalizedCity).toBe('Cape Town');
  });

  it('findByHash scopes to (client, partition)', async () => {
    const a = pendingMaster(clientId, { hash: 'shared-hash' });
    await repo.persist(a);

    expect((await repo.findByHash(clientId, null, 'shared-hash'))?.id).toBe(a.id);
    expect(
      (await repo.findByHash(asClientId('cli_other'), null, 'shared-hash'))?.id,
    ).toBeUndefined();
  });

  it('listByClient honours the optional status filter', async () => {
    const pending = await repo.persist(pendingMaster(clientId));
    const geocoded = MasterLocation.geocoded(
      pendingMaster(clientId),
      { latitude: 0, longitude: 0 },
      new Date(),
    );
    await repo.persist(geocoded);

    const all = await repo.listByClient({ clientId, limit: 10, offset: 0 });
    expect(all.total).toBe(2);

    const onlyPending = await repo.listByClient({
      clientId,
      status: 'PENDING',
      limit: 10,
      offset: 0,
    });
    expect(onlyPending.total).toBe(1);
    expect(onlyPending.masters[0]?.id).toBe(pending.id);
  });

  it('findUnvalidated returns everything except VALIDATED', async () => {
    await repo.persist(pendingMaster(clientId));
    const validated = MasterLocation.confirmed(
      MasterLocation.geocoded(pendingMaster(clientId), { latitude: 0, longitude: 0 }, new Date()),
      new Date(),
    );
    await repo.persist(validated);

    const { masters, total } = await repo.findUnvalidated({
      clientIds: [clientId],
      partitionIds: null,
      limit: 10,
      offset: 0,
      ascending: true,
    });
    expect(total).toBe(1);
    expect(masters[0]?.status).toBe('PENDING');
  });

  it('applyConfirmedGeocode updates address fields + coordinates atomically', async () => {
    const m = await repo.persist(pendingMaster(clientId));

    await repo.applyConfirmedGeocode({
      masterLocationId: m.id,
      normalizedHouseNumber: '548',
      normalizedRoad: 'Market Street',
      normalizedSuburb: null,
      normalizedCity: 'San Francisco',
      normalizedState: 'CA',
      normalizedPostalCode: '94104',
      normalizedCountry: 'United States',
      addressHash: 'new-hash',
      normalizedAddressLine: '548 Market Street, San Francisco, United States',
      latitude: 37.78999,
      longitude: -122.40085,
    });

    const fetched = await repo.findById(m.id);
    expect(fetched?.normalizedHouseNumber).toBe('548');
    expect(fetched?.addressHash).toBe('new-hash');
    expect(fetched?.latitude).toBe(37.78999);
    expect(fetched?.longitude).toBe(-122.40085);
  });
});
