import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateTsid } from '@flowcatalyst/sdk';
import { isSuccess } from '@pinpoint/framework';
import {
  asMasterLocationId,
  MASTER_LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { seedClient } from './_operator-seeds.js';

describe('ConfirmMasterLocationGeocodeUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  beforeAll(async () => {
    db = (await getDbFixture()).db;
    appContext = await getTestAppContext();
  });
  beforeEach(async () => {
    await cleanDb();
  });

  it('applies operator components + coords, recomputes the hash, moves to GEOCODED, emits geocode-confirmed', async () => {
    const { clientId } = await seedClient(appContext);
    const masterId = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
    await appContext.repositories.masterLocations.persist(
      MasterLocation.create({
        id: masterId,
        clientId,
        partitionId: null,
        normalizedHouseNumber: null,
        normalizedRoad: null,
        normalizedSuburb: null,
        normalizedCity: 'Somewhere',
        normalizedState: null,
        normalizedPostalCode: null,
        normalizedCountry: 'South Africa',
        addressHash: 'old-hash',
        normalizedAddressLine: 'Somewhere, South Africa',
        now: new Date(),
      }),
    );

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.confirmMasterLocationGeocode.execute({
          clientId,
          masterLocationId: masterId,
          houseNumber: '12',
          road: 'Long Street',
          city: 'Cape Town',
          postalCode: '8001',
          country: 'South Africa',
          latitude: -33.92,
          longitude: 18.42,
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);
    const master = await appContext.repositories.masterLocations.findById(masterId);
    expect(master?.status).toBe('GEOCODED');
    expect(master?.latitude).toBeCloseTo(-33.92);
    expect(master?.normalizedRoad).toBe('Long Street');
    expect(master?.addressHash).not.toBe('old-hash');
    expect(master?.normalizedAddressLine).toContain('Long Street');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE payload::jsonb->>'type' = 'pinpoint:locations:master_location:geocode-confirmed'
    `);
    expect(events.length).toBe(1);
    const log = await appContext.repositories.processingLog.listByMaster(masterId);
    expect(log.some((e) => e.step === 'confirm-geocode')).toBe(true);
  });
});
