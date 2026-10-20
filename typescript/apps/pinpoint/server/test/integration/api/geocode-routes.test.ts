/**
 * The geocode routes check pinpoint's own master locations first: a VALIDATED
 * master for the same address answers with its stored coordinates (`source:
 * MASTER_LOCATIONS`), `forceGeocode` skips that, and only masters the caller
 * may see count. Photon is mocked; the verifier is Noop, so only exact
 * address-line duplicates match here.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import { Scope, ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../src/app-context.js';
import { ALL_ACCESS_ATTRIBUTES, ALL_PERMISSIONS_SET } from '../../../src/auth/role-permissions.js';
import { SHARED_SCHEMAS } from '../../../src/api/plugins/shared-schemas.js';
import { registerGeocodeRoutes } from '../../../src/api/routes/geocode/index.js';
import { asPrincipalId } from '../../../src/domain/auth/ids.js';
import {
  asMasterLocationId,
  MASTER_LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import { addressLineHash, tidyAddressLine } from '../../../src/domain/services/address-line.js';
import { asPartitionId, type ClientId } from '../../../src/domain/tenancy/ids.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { installFetchMock, jsonResponse, type FetchMock } from '../fetch-mock.js';
import { getTestAppContext } from '../test-app-context.js';
import { seedClient } from '../use-cases/_operator-seeds.js';

const LINE = '12 Long Street, Cape Town, South Africa';

describe('geocode routes — master locations first (integration)', () => {
  let appContext: AppContext;
  let server: FastifyInstance;
  let mock: FetchMock;

  beforeAll(async () => {
    await getDbFixture();
    mock = installFetchMock();
    appContext = await getTestAppContext();
    server = Fastify();
    for (const schema of SHARED_SCHEMAS) server.addSchema(schema);
    // Default caller: admin (sees every client). `x-principal` = a non-admin.
    server.addHook('onRequest', (req, _reply, done) => {
      const principal = req.headers['x-principal'];
      const sub = typeof principal === 'string' ? principal : 'prn_admin';
      const attributes = typeof principal === 'string' ? {} : ALL_ACCESS_ATTRIBUTES;
      ScopeStore.run(
        Scope.fromRequest({ sub, permissions: ALL_PERMISSIONS_SET, attributes }),
        done,
      );
    });
    registerGeocodeRoutes(server, appContext);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    mock.restore();
  });

  beforeEach(async () => {
    await cleanDb();
    mock.reset();
    mock.handle('GET', /\/api\b/, () =>
      jsonResponse({
        features: [
          {
            geometry: { coordinates: [18.4187, -33.9221] },
            properties: {
              housenumber: '12',
              street: 'Long Street',
              city: 'Cape Town',
              country: 'South Africa',
              countrycode: 'ZA',
            },
          },
        ],
      }),
    );
  });

  async function seedValidatedMaster(clientId: ClientId, partitionId: string): Promise<string> {
    const now = new Date();
    const id = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
    const pending = MasterLocation.create({
      id,
      clientId,
      partitionId: asPartitionId(partitionId),
      normalizedHouseNumber: '12',
      normalizedRoad: 'Long Street',
      normalizedSuburb: null,
      normalizedCity: 'Cape Town',
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: 'ZA',
      addressHash: addressLineHash(LINE),
      normalizedAddressLine: tidyAddressLine(LINE),
      now,
    });
    const geocoded = MasterLocation.geocoded(
      pending,
      { latitude: -33.92, longitude: 18.42, source: 'OPERATOR' },
      now,
    );
    await appContext.repositories.masterLocations.persist(MasterLocation.confirmed(geocoded, now));
    return id;
  }

  const address = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    server.inject({ method: 'POST', url: '/geocode/address', payload: body, headers });

  it('answers from a matching master location without calling the geocoder', async () => {
    const acme = await seedClient(appContext);
    const masterId = await seedValidatedMaster(acme.clientId, acme.defaultPartitionId);

    const res = await address({ address: LINE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      source: 'MASTER_LOCATIONS',
      masterLocationId: masterId,
      matchMethod: 'EXACT_HASH',
      geocodeSource: 'OPERATOR',
      latitude: -33.92,
      longitude: 18.42,
      confidence: 1,
    });
    expect(mock.calls).toHaveLength(0);

    const forward = await server.inject({
      method: 'POST',
      url: '/geocode/forward',
      payload: {
        houseNumber: '12',
        road: 'Long Street',
        city: 'Cape Town',
        country: 'South Africa',
      },
    });
    expect(forward.json()).toMatchObject({
      source: 'MASTER_LOCATIONS',
      masterLocationId: masterId,
    });
  });

  it('forceGeocode skips the master check', async () => {
    const acme = await seedClient(appContext);
    await seedValidatedMaster(acme.clientId, acme.defaultPartitionId);

    const res = await address({ address: LINE, forceGeocode: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      source: 'PHOTON',
      masterLocationId: null,
      matchMethod: null,
      latitude: -33.9221,
    });
    expect(mock.calls.length).toBeGreaterThan(0);
  });

  it('only considers masters the caller may see, and refuses clients they cannot', async () => {
    const acme = await seedClient(appContext);
    const other = await seedClient(appContext);
    await seedValidatedMaster(acme.clientId, acme.defaultPartitionId);
    const principals = appContext.repositories.principals;
    await principals.upsert({ id: asPrincipalId('prn_admin'), principalType: 'USER', name: 'A' });
    await principals.upsert({ id: asPrincipalId('prn_bob'), principalType: 'USER', name: 'Bob' });
    await principals.grantPartitionAccess(
      asPrincipalId('prn_bob'),
      asPartitionId(other.defaultPartitionId),
      asPrincipalId('prn_admin'),
    );
    const asBob = { 'x-principal': 'prn_bob' };

    // Bob can't see Acme's master → the geocoder answers.
    const res = await address({ address: LINE }, asBob);
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBe('PHOTON');

    const denied = await address({ address: LINE, clientId: acme.clientId }, asBob);
    expect(denied.statusCode).toBe(403);
  });
});
