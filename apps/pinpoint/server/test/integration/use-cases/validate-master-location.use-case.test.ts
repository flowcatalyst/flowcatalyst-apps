/**
 * Integration test for ValidateMasterLocationUseCase. The Rust name is
 * misleading — this is the geocode step (PENDING → GEOCODED), not the
 * canonicalize step (see confirm-master-location.use-case.test.ts).
 *
 * Mocks Photon via the global-fetch shim because the geocoder is the
 * one external service this use case touches. Verifies:
 *   - lat/lon land on the master row,
 *   - status → GEOCODED,
 *   - MasterLocationGeocoded event in the outbox.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { installFetchMock, jsonResponse, type FetchMock } from '../fetch-mock.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('ValidateMasterLocationUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  let mock: FetchMock;

  beforeAll(async () => {
    const fixture = await getDbFixture();
    db = fixture.db;
    appContext = await getTestAppContext();
    mock = installFetchMock();
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(async () => {
    await cleanDb();
    mock.reset();
  });

  async function seedPendingMaster(): Promise<string> {
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.value.getData().clientId;

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
      now: new Date(),
    });
    await appContext.repositories.masterLocations.persist(pending);
    return masterId;
  }

  it('geocodes a PENDING master and emits MasterLocationGeocoded', async () => {
    const masterLocationId = await seedPendingMaster();

    // Photon `/api?q=...&limit=1` → one feature with lon/lat coords.
    mock.handle('GET', /\/api\b/, () =>
      jsonResponse({
        features: [
          {
            geometry: { coordinates: [-122.40085, 37.78999] },
            properties: {
              housenumber: '548',
              street: 'Market Street',
              city: 'San Francisco',
              state: 'California',
              postcode: '94104',
              country: 'United States',
              countrycode: 'US',
            },
          },
        ],
      }),
    );

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.validateMasterLocation.execute({ masterLocationId }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    // Row updated.
    const fetched = await appContext.repositories.masterLocations.findById(
      masterLocationId as never,
    );
    expect(fetched?.status).toBe('GEOCODED');
    expect(fetched?.latitude).toBeCloseTo(37.78999, 4);
    expect(fetched?.longitude).toBeCloseTo(-122.40085, 4);

    // Event landed in the outbox.
    const events = await db.execute(sql`
      SELECT payload FROM outbox_messages
      WHERE type = 'EVENT'
        AND payload::jsonb->>'type' = 'pinpoint:locations:master_location:geocoded'
    `);
    expect(events.length).toBe(1);

    // Confirm we actually called Photon.
    expect(mock.calls.some((c) => c.includes('/api?'))).toBe(true);
  });

  it('rejects re-validating an already-GEOCODED master', async () => {
    // Seed straight to GEOCODED status via the domain helper.
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.value.getData().clientId;

    const masterId = asMasterLocationId(
      `${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`,
    );
    const now = new Date();
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

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.validateMasterLocation.execute({
          masterLocationId: masterId,
        }),
      ),
    );

    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('business_rule');
  });

  it('surfaces a geocoder failure as InfrastructureError', async () => {
    const masterLocationId = await seedPendingMaster();

    mock.handle('GET', /\/api\b/, () =>
      new Response('upstream timeout', { status: 504 }),
    );

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.validateMasterLocation.execute({ masterLocationId }),
      ),
    );

    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('infrastructure');
  });
});
