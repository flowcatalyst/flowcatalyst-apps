/**
 * Integration test for ProcessingLogRepository. Two methods, both
 * simple: append (writes a row) + listByMaster (reads them back in
 * timestamp order).
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
import { createDrizzleProcessingLogRepository } from '../../../src/infrastructure/processing-log-repository.js';
import type { ProcessingLogRepository } from '../../../src/domain/locations/processing-log.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

describe('ProcessingLogRepository (integration)', () => {
  let repo: ProcessingLogRepository;
  let masterLocationId: ReturnType<typeof asMasterLocationId>;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzleProcessingLogRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();

    // Seed a client + master location each test so the FK is satisfied.
    const { db } = await getDbFixture();
    const clientRepo = createDrizzleClientRepository(db);
    const masterRepo = createDrizzleMasterLocationRepository(db);
    const clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    await clientRepo.persist(
      Client.create({ id: clientId, name: 'Acme', code: `C_${generateTsid()}`, now: new Date() }),
    );
    masterLocationId = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
    await masterRepo.persist(
      MasterLocation.create({
        id: masterLocationId,
        clientId,
        partitionId: null,
        normalizedHouseNumber: null,
        normalizedRoad: null,
        normalizedSuburb: null,
        normalizedCity: 'Cape Town',
        normalizedState: null,
        normalizedPostalCode: null,
        normalizedCountry: 'South Africa',
        addressHash: `h_${generateTsid()}`,
        normalizedAddressLine: 'Cape Town, South Africa',
        now: new Date(),
      }),
    );
  });

  it('append + listByMaster roundtrips entries in insertion order', async () => {
    await repo.append(masterLocationId, 'normalized', { source: 'libpostal' });
    await repo.append(masterLocationId, 'geocoded', { latitude: -33.9, longitude: 18.4 });
    await repo.append(masterLocationId, 'validated', { reason: 'manual' });

    const entries = await repo.listByMaster(masterLocationId);
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.step)).toEqual(['normalized', 'geocoded', 'validated']);
    expect(entries[1]?.data).toMatchObject({ latitude: -33.9, longitude: 18.4 });
  });

  it('listByMaster returns empty for an unseen master', async () => {
    const entries = await repo.listByMaster(asMasterLocationId('mlo_ghost'));
    expect(entries).toEqual([]);
  });
});
