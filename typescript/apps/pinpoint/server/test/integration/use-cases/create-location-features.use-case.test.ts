/**
 * Regression: a location that matches a VALIDATED master with coordinates is
 * validated immediately and gets its feature associations — written on the
 * use-case transaction (before the fix the association insert ran on the pool
 * and hit the locations FK because the location row was not committed yet).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import { isSuccess } from '@pinpoint/framework';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import {
  asMasterLocationId,
  MASTER_LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { asPartitionId } from '../../../src/domain/tenancy/ids.js';
import {
  addressHash as computeAddressHash,
  toAddressLine,
  type NormalizedAddress,
} from '../../../src/domain/services/address-normalizer.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import { installFetchMock, jsonResponse, type FetchMock } from '../fetch-mock.js';
import type { AppContext } from '../../../src/app-context.js';
import { seedClient, seedLayerWithRadiusFeature } from './_operator-seeds.js';

const CBD = { lat: -33.9249, lon: 18.4241 };
const PARSE = [
  { label: 'house_number', value: '12' },
  { label: 'road', value: 'long street' },
  { label: 'city', value: 'cape town' },
  { label: 'postcode', value: '8001' },
  { label: 'country', value: 'south africa' },
];
const NORMALIZED: NormalizedAddress = {
  houseNumber: '12',
  road: 'long street',
  suburb: null,
  city: 'cape town',
  state: null,
  postalCode: '8001',
  country: 'south africa',
};

describe('CreateLocationUseCase — validated master with features (integration)', () => {
  let appContext: AppContext;
  let mock: FetchMock;
  beforeAll(async () => {
    await getDbFixture();
    appContext = await getTestAppContext();
    mock = installFetchMock();
  });
  afterAll(() => mock.restore());
  beforeEach(async () => {
    await cleanDb();
    mock.reset();
    mock.handle('GET', /\/parse\b/, () => jsonResponse(PARSE));
    mock.handle('GET', /\/expand\b/, () => jsonResponse(['long street']));
  });

  it('EXACT_HASH onto a VALIDATED master → location VALIDATED with feature associations', async () => {
    const { clientId, defaultPartitionId } = await seedClient(appContext);
    const { featureId } = await seedLayerWithRadiusFeature(appContext, clientId, CBD);
    const now = new Date();
    const masterId = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
    const pending = MasterLocation.create({
      id: masterId,
      clientId,
      partitionId: asPartitionId(defaultPartitionId),
      normalizedHouseNumber: NORMALIZED.houseNumber,
      normalizedRoad: NORMALIZED.road,
      normalizedSuburb: null,
      normalizedCity: NORMALIZED.city,
      normalizedState: null,
      normalizedPostalCode: NORMALIZED.postalCode,
      normalizedCountry: NORMALIZED.country,
      addressHash: computeAddressHash(NORMALIZED),
      normalizedAddressLine: toAddressLine(NORMALIZED),
      now,
    });
    const validated = MasterLocation.confirmed(
      MasterLocation.geocoded(pending, { latitude: CBD.lat, longitude: CBD.lon }, now),
      now,
    );
    await appContext.repositories.masterLocations.persist(validated);

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createLocation.execute({
          clientId,
          partitionId: defaultPartitionId,
          address: '12 Long Street, Cape Town, 8001',
          name: 'Head office',
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    const locationId = result.value.getData().locationId;
    const loc = await appContext.repositories.locations.findById(locationId as never);
    expect(loc?.masterLocationId).toBe(masterId);
    expect(loc?.matchMethod).toBe('EXACT_HASH');
    expect(loc?.status).toBe('VALIDATED');
    const assoc = await appContext.repositories.layerFeatures.findFeatureAssociations(locationId);
    expect(assoc.map((a) => a.layerFeatureId)).toEqual([featureId]);
  });
});
