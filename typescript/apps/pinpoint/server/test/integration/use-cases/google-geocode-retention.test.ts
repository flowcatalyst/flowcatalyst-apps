/**
 * Google Maps coordinates may be cached for 30 days. With the Google fallback
 * configured: a master Photon can only place at street level is geocoded by
 * Google and gets a 30-day expiry; the daily refresh renews it (a Photon hit
 * replaces it for good), and one past expiry whose refresh fails loses its
 * coordinates and goes back to PENDING. Photon and Google are both mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateTsid } from '@flowcatalyst/sdk';
import { isFailure, isSuccess } from '@pinpoint/framework';
import { createAppContext, type AppContext } from '../../../src/app-context.js';
import {
  asMasterLocationId,
  MASTER_LOCATION_ID_PREFIX,
  type MasterLocationId,
} from '../../../src/domain/locations/ids.js';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import { runRefreshCachedGeocodesBatch } from '../../../src/scheduling/index.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { installFetchMock, jsonResponse, type FetchMock } from '../fetch-mock.js';
import { runInScope } from '../test-app-context.js';
import { seedClient } from './_operator-seeds.js';

const DAY = 24 * 60 * 60 * 1000;

const PHOTON_STREET = {
  features: [
    {
      geometry: { coordinates: [28.0122, -26.1187] },
      properties: {
        type: 'street',
        osm_key: 'highway',
        name: 'Curvy Road',
        city: 'Randburg',
        country: 'South Africa',
        countrycode: 'ZA',
      },
    },
  ],
};
const PHOTON_HOUSE = {
  features: [
    {
      geometry: { coordinates: [28.0131, -26.1191] },
      properties: {
        housenumber: '16',
        street: 'Curvy Road',
        city: 'Randburg',
        country: 'South Africa',
        countrycode: 'ZA',
      },
    },
  ],
};
const GOOGLE_HOUSE = {
  status: 'OK',
  results: [
    {
      formatted_address: '16 Curvy Rd, Blairgowrie, Randburg, 2194, South Africa',
      geometry: { location: { lat: -26.1189, lng: 28.0127 }, location_type: 'ROOFTOP' },
      address_components: [
        { long_name: '16', short_name: '16', types: ['street_number'] },
        { long_name: 'Curvy Road', short_name: 'Curvy Rd', types: ['route'] },
        {
          long_name: 'Blairgowrie',
          short_name: 'Blairgowrie',
          types: ['sublocality_level_1', 'sublocality'],
        },
        { long_name: 'Randburg', short_name: 'Randburg', types: ['locality'] },
        { long_name: 'South Africa', short_name: 'ZA', types: ['country'] },
      ],
    },
  ],
};

describe('Google geocode retention (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  let mock: FetchMock;

  beforeAll(async () => {
    db = (await getDbFixture()).db;
    mock = installFetchMock();
    appContext = await createAppContext({
      db,
      clientId: 'test',
      publicBaseUrl: 'http://localhost:3000',
      dispatchPoolCode: 'test-pool',
      geocodingApiUrl: 'http://geocoder.invalid',
      geocodingRateLimit: 5,
      googleMaps: { apiKey: 'test-key', rateLimit: 10, cacheDays: 30 },
      addressVerifier: { provider: 'none' },
      auth: {
        oidc: null,
        devFallback: false,
        postLoginRedirect: '/',
        session: { driver: 'memory', redisUrl: null },
      },
    });
  });

  afterAll(() => mock.restore());

  beforeEach(async () => {
    await cleanDb();
    mock.reset();
  });

  const photon = (body: unknown) =>
    mock.handle('GET', /geocoder\.invalid\/api\b/, () => jsonResponse(body));
  const google = (body: unknown) =>
    mock.handle('GET', /\/maps\/api\/geocode\/json/, () => jsonResponse(body));

  async function seedPendingMaster(): Promise<MasterLocationId> {
    const { clientId } = await seedClient(appContext);
    const id = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
    await appContext.repositories.masterLocations.persist(
      MasterLocation.create({
        id,
        clientId,
        partitionId: null,
        normalizedHouseNumber: '16',
        normalizedRoad: 'Curvy Road',
        normalizedSuburb: 'Blairgowrie',
        normalizedCity: 'Randburg',
        normalizedState: null,
        normalizedPostalCode: '2194',
        normalizedCountry: 'ZA',
        addressHash: `h-${generateTsid()}`,
        normalizedAddressLine: '16 curvy road, blairgowrie, randburg, 2194',
        now: new Date(),
      }),
    );
    return id;
  }

  const validate = (masterLocationId: string) =>
    runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.validateMasterLocation.execute({ masterLocationId }),
      ),
    );
  const refresh = (masterLocationId: string) =>
    runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.refreshMasterLocationGeocode.execute({ masterLocationId }),
      ),
    );
  const find = (id: MasterLocationId) => appContext.repositories.masterLocations.findById(id);

  /** Seed a master geocoded by Google that expires in `days`. */
  async function seedGoogleMaster(days: number): Promise<MasterLocationId> {
    const id = await seedPendingMaster();
    const master = (await find(id))!;
    await appContext.repositories.masterLocations.persist(
      MasterLocation.geocoded(
        master,
        {
          latitude: -26.1189,
          longitude: 28.0127,
          source: 'GOOGLE_MAPS',
          expiresAt: new Date(Date.now() + days * DAY),
        },
        new Date(),
      ),
    );
    return id;
  }

  it('falls back to Google for the house number, and caches it for 30 days', async () => {
    const id = await seedPendingMaster();
    photon(PHOTON_STREET);
    google(GOOGLE_HOUSE);

    expect(isSuccess(await validate(id))).toBe(true);

    const master = await find(id);
    expect(master).toMatchObject({
      status: 'GEOCODED',
      geocodeSource: 'GOOGLE_MAPS',
      latitude: -26.1189,
    });
    const days = (master!.geocodeExpiresAt!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const [event] = await db.execute(sql`
      SELECT (payload::jsonb->>'data')::jsonb->>'source' AS source FROM outbox_messages
      WHERE payload::jsonb->>'type' = 'pinpoint:locations:master_location:geocoded'`);
    expect(event?.['source']).toBe('GOOGLE_MAPS');
  });

  it('keeps Photon results with no expiry when Photon has the house', async () => {
    const id = await seedPendingMaster();
    photon(PHOTON_HOUSE);

    expect(isSuccess(await validate(id))).toBe(true);
    expect(await find(id)).toMatchObject({ geocodeSource: 'PHOTON', geocodeExpiresAt: null });
    expect(mock.calls.some((c) => c.includes('/maps/api/geocode'))).toBe(false);
  });

  it('refresh: a Photon hit replaces the Google geocode for good', async () => {
    const id = await seedGoogleMaster(2);
    photon(PHOTON_HOUSE);

    const result = await refresh(id);
    expect(isSuccess(result)).toBe(true);
    expect(await find(id)).toMatchObject({
      geocodeSource: 'PHOTON',
      geocodeExpiresAt: null,
      latitude: -26.1191,
      status: 'GEOCODED',
    });
  });

  it('refresh: a new Google geocode restarts the 30 days', async () => {
    const id = await seedGoogleMaster(2);
    photon(PHOTON_STREET);
    google(GOOGLE_HOUSE);

    expect(isSuccess(await refresh(id))).toBe(true);
    const master = await find(id);
    expect(master?.geocodeSource).toBe('GOOGLE_MAPS');
    expect(master!.geocodeExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it('a failed refresh before expiry changes nothing; after expiry it deletes the coordinates', async () => {
    photon({ features: [] });
    google({ status: 'ZERO_RESULTS', results: [] });

    const fresh = await seedGoogleMaster(2);
    const early = await refresh(fresh);
    expect(isFailure(early) && early.error.code).toBe('GEOCODER_FAILED');
    expect(await find(fresh)).toMatchObject({ geocodeSource: 'GOOGLE_MAPS', latitude: -26.1189 });

    const stale = await seedGoogleMaster(-1);
    expect(isSuccess(await refresh(stale))).toBe(true);
    expect(await find(stale)).toMatchObject({
      status: 'PENDING',
      latitude: null,
      longitude: null,
      geocodeSource: null,
      geocodeExpiresAt: null,
    });
    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE payload::jsonb->>'type' = 'pinpoint:locations:master_location:geocode_expired'`);
    expect(events).toHaveLength(1);
  });

  it('the daily batch picks up only masters near expiry', async () => {
    const due = await seedGoogleMaster(1);
    const later = await seedGoogleMaster(20);
    photon(PHOTON_HOUSE);

    const summary = await runInScope({ sub: 'prn_test' }, () =>
      runRefreshCachedGeocodesBatch(appContext),
    );
    expect(summary).toMatchObject({ attempted: 1, refreshed: 1, expired: 0, failed: 0 });
    expect((await find(due))?.geocodeSource).toBe('PHOTON');
    expect((await find(later))?.geocodeSource).toBe('GOOGLE_MAPS');
  });
});
