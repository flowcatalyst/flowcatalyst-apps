/**
 * Integration test for UpdateMasterLocationUseCase. Seeds a PENDING
 * master directly, runs the manual edit, verifies the field update +
 * recomputed addressHash + MasterLocationUpdated event.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  asLocationId,
  asMasterLocationId,
  LOCATION_ID_PREFIX,
  MASTER_LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { asClientId } from '../../../src/domain/tenancy/ids.js';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import type { Location } from '../../../src/domain/locations/location.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('UpdateMasterLocationUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];

  beforeAll(async () => {
    const fixture = await getDbFixture();
    db = fixture.db;
    appContext = await getTestAppContext();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  async function seed(): Promise<{ clientId: string; masterLocationId: string }> {
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.value.getData().clientId;

    const now = new Date();
    const masterId = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
    const pending = MasterLocation.create({
      id: masterId,
      clientId: asClientId(clientId),
      partitionId: null,
      normalizedHouseNumber: null,
      normalizedRoad: 'Market St',
      normalizedSuburb: null,
      normalizedCity: 'San Franciso', // typo on purpose — what we'll fix
      normalizedState: 'CA',
      normalizedPostalCode: null,
      normalizedCountry: 'United States',
      addressHash: 'pre-update-hash',
      normalizedAddressLine: 'Market St, San Franciso, United States',
      now,
    });
    await appContext.repositories.masterLocations.persist(pending);
    return { clientId, masterLocationId: masterId };
  }

  it('updates normalized fields + recomputes hash + emits MasterLocationUpdated', async () => {
    const { clientId, masterLocationId } = await seed();

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.updateMasterLocation.execute({
          clientId,
          masterLocationId,
          normalizedHouseNumber: '548',
          normalizedRoad: 'Market Street',
          normalizedSuburb: null,
          normalizedCity: 'San Francisco',
          normalizedState: 'CA',
          normalizedPostalCode: '94104',
          normalizedCountry: 'United States',
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    const master = await appContext.repositories.masterLocations.findById(
      masterLocationId as never,
    );
    expect(master?.normalizedHouseNumber).toBe('548');
    expect(master?.normalizedCity).toBe('San Francisco');
    // Hash must have changed away from the seeded pre-update-hash.
    expect(master?.addressHash).not.toBe('pre-update-hash');
    // normalizedAddressLine reflects new fields.
    expect(master?.normalizedAddressLine).toContain('548');
    expect(master?.normalizedAddressLine).toContain('San Francisco');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:locations:master_location:updated'
    `);
    expect(events.length).toBe(1);
  });

  it('resets status to PENDING and reports the linked locations', async () => {
    const { clientId, masterLocationId } = await seed();

    // Promote the seeded master to VALIDATED so the reset is observable.
    const master = await appContext.repositories.masterLocations.findById(masterLocationId as never);
    if (!master) throw new Error('master not found');
    const geocoded = MasterLocation.geocoded(master, { latitude: 1, longitude: 2 }, new Date());
    await appContext.repositories.masterLocations.persist(MasterLocation.confirmed(geocoded, new Date()));

    // Link a location to it.
    const loc: Location = {
      id: asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`),
      clientId: asClientId(clientId),
      partitionId: null,
      masterLocationId: asMasterLocationId(masterLocationId),
      externalId: null,
      name: null,
      rawAddressLine1: 'Market St, San Francisco',
      matchAddress: 'Market St, San Francisco',
      rawAddressLine2: null,
      rawSuburb: null,
      rawCity: 'san francisco',
      rawState: null,
      rawPostalCode: null,
      rawCountry: 'usa',
      normalizedHouseNumber: null,
      normalizedRoad: null,
      normalizedSuburb: null,
      normalizedCity: null,
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: null,
      addressHash: null,
      matchConfidence: null,
      matchMethod: null,
      status: 'VALIDATED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await appContext.repositories.locations.persist(loc);

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.updateMasterLocation.execute({
          clientId,
          masterLocationId,
          normalizedCity: 'San Francisco',
          normalizedCountry: 'United States',
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    const data = result.value.getData();
    expect(data.status).toBe('PENDING');
    expect(data.linkedLocationIds).toContain(loc.id);

    const after = await appContext.repositories.masterLocations.findById(masterLocationId as never);
    expect(after?.status).toBe('PENDING');
  });

  it('404s on a missing master', async () => {
    const { clientId } = await seed();
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.updateMasterLocation.execute({
          clientId,
          masterLocationId: 'mlo_NOPE',
          normalizedCity: 'X',
          normalizedCountry: 'Y',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
