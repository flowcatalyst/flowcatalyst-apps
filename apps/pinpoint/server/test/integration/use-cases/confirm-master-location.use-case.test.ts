/**
 * Integration test for ConfirmMasterLocationUseCase. Seeds a GEOCODED
 * master directly via repo.persist (skipping the geocoder), runs the
 * use case, and verifies status → VALIDATED + MasterLocationValidated
 * outbox event. The cascade-to-child-locations flow is exercised via
 * the master's child via location_repo (no children = empty cascade,
 * still emits the master event).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  asMasterLocationId,
  MASTER_LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { asClientId } from '../../../src/domain/tenancy/ids.js';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('ConfirmMasterLocationUseCase (integration)', () => {
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

  async function seedGeocodedMaster(): Promise<{
    clientId: string;
    masterLocationId: string;
  }> {
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.value.getData().clientId;

    const now = new Date();
    const masterId = asMasterLocationId(
      `${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`,
    );
    const pending = MasterLocation.create({
      id: masterId,
      clientId: asClientId(clientId),
      partitionId: null,
      normalizedHouseNumber: null,
      normalizedRoad: 'Market Street',
      normalizedSuburb: null,
      normalizedCity: 'San Francisco',
      normalizedState: 'CA',
      normalizedPostalCode: '94104',
      normalizedCountry: 'United States',
      addressHash: 'test-hash',
      normalizedAddressLine: 'Market Street, San Francisco, United States',
      now,
    });
    const geocoded = MasterLocation.geocoded(
      pending,
      { latitude: 37.78999, longitude: -122.40085 },
      now,
    );
    await appContext.repositories.masterLocations.persist(geocoded);
    return { clientId, masterLocationId: masterId };
  }

  it('transitions GEOCODED → VALIDATED and emits MasterLocationValidated', async () => {
    const { clientId, masterLocationId } = await seedGeocodedMaster();

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.confirmMasterLocation.execute({
          clientId,
          masterLocationId,
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    const master = await appContext.repositories.masterLocations.findById(
      masterLocationId as never,
    );
    expect(master?.status).toBe('VALIDATED');
    expect(master?.validatedAt).not.toBeNull();

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:locations:master_location:validated'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing master', async () => {
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.confirmMasterLocation.execute({
          clientId: 'cli_NOPE',
          masterLocationId: 'mlo_NOPE',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
