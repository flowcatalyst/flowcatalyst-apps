/**
 * Integration test for LocationAttributeRepository. Two methods:
 * insertMany (child rows under a parent location) + listByLocation.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  asLocationAttributeId,
  asLocationId,
  LOCATION_ATTRIBUTE_ID_PREFIX,
  LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { asClientId, CLIENT_ID_PREFIX } from '../../../src/domain/tenancy/ids.js';
import { Client } from '../../../src/domain/tenancy/client.js';
import { Location } from '../../../src/domain/locations/location.js';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { createDrizzleLocationRepository } from '../../../src/infrastructure/location-repository.js';
import { createDrizzleLocationAttributeRepository } from '../../../src/infrastructure/location-attribute-repository.js';
import type { LocationAttribute } from '../../../src/domain/locations/location-attribute.js';
import type { LocationAttributeRepository } from '../../../src/domain/locations/location-attribute.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

describe('LocationAttributeRepository (integration)', () => {
  let repo: LocationAttributeRepository;
  let locationId: ReturnType<typeof asLocationId>;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzleLocationAttributeRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
    const { db } = await getDbFixture();

    const clientRepo = createDrizzleClientRepository(db);
    const locationRepo = createDrizzleLocationRepository(db);
    const clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    await clientRepo.persist(
      Client.create({ id: clientId, name: 'Acme', code: `LA_${generateTsid()}`, now: new Date() }),
    );

    locationId = asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`);
    await locationRepo.persist(
      Location.create({
        id: locationId,
        clientId,
        partitionId: null,
        externalId: null,
        name: 'X',
        rawAddressLine1: 'Y',
        rawAddressLine2: null,
        rawSuburb: null,
        rawCity: 'Z',
        rawState: null,
        rawPostalCode: null,
        rawCountry: 'ZA',
        now: new Date(),
      }),
    );
  });

  function attr(key: string, value: string | readonly string[]): LocationAttribute {
    const now = new Date();
    return {
      id: asLocationAttributeId(`${LOCATION_ATTRIBUTE_ID_PREFIX}_${generateTsid()}`),
      locationId,
      key,
      value,
      createdAt: now,
      updatedAt: now,
    };
  }

  it('insertMany persists child rows + listByLocation reads them back', async () => {
    await repo.insertMany([attr('tier', 'gold'), attr('tags', ['a', 'b', 'c'])]);

    const rows = await repo.listByLocation(locationId);
    expect(rows.length).toBe(2);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    expect(byKey.get('tier')).toBe('gold');
    expect(byKey.get('tags')).toEqual(['a', 'b', 'c']);
  });

  it('listByLocation returns empty for an empty parent', async () => {
    expect(await repo.listByLocation(asLocationId('loc_ghost'))).toEqual([]);
  });
});
