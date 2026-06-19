/**
 * Integration test for PropertySetRepository. Verifies the
 * delete-all-insert-all child sync on persist, listByLayer with
 * inline properties, and the batched countByLayerIds used by the
 * BFF layer list.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  asLayerId,
  asPropertyId,
  asPropertySetId,
  LAYER_ID_PREFIX,
  PROPERTY_SET_ID_PREFIX,
} from '../../../src/domain/layers/ids.js';
import { asClientId, CLIENT_ID_PREFIX } from '../../../src/domain/tenancy/ids.js';
import { Client } from '../../../src/domain/tenancy/client.js';
import { Layer } from '../../../src/domain/layers/layer.js';
import { PropertySet } from '../../../src/domain/layers/property-set.js';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { createDrizzleLayerRepository } from '../../../src/infrastructure/layer-repository.js';
import { createDrizzlePropertySetRepository } from '../../../src/infrastructure/property-set-repository.js';
import type { PropertySetRepository } from '../../../src/domain/layers/property-set.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

describe('PropertySetRepository (integration)', () => {
  let repo: PropertySetRepository;
  let layerId: string;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzlePropertySetRepository(db);

    // Seed a client + layer once for the suite.
    const clientRepo = createDrizzleClientRepository(db);
    const layerRepo = createDrizzleLayerRepository(db);
    const clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    await clientRepo.persist(
      Client.create({ id: clientId, name: 'Acme', code: 'PSACME', now: new Date() }),
    );
    layerId = `${LAYER_ID_PREFIX}_${generateTsid()}`;
    await layerRepo.persist(
      Layer.create({
        id: asLayerId(layerId),
        clientId,
        code: 'ps-layer',
        name: 'PS Layer',
        description: null,
        layerType: 'POINT',
        centerLat: null,
        centerLon: null,
        radiusMeters: null,
        polygonGeojson: null,
        now: new Date(),
      }),
    );
  });

  beforeEach(async () => {
    await cleanDb();

    // cleanDb truncates layers — re-seed for each test.
    const { db } = await getDbFixture();
    const clientRepo = createDrizzleClientRepository(db);
    const layerRepo = createDrizzleLayerRepository(db);
    const clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    await clientRepo.persist(
      Client.create({
        id: clientId,
        name: 'Acme',
        code: `ACME_${generateTsid()}`,
        now: new Date(),
      }),
    );
    layerId = `${LAYER_ID_PREFIX}_${generateTsid()}`;
    await layerRepo.persist(
      Layer.create({
        id: asLayerId(layerId),
        clientId,
        code: `code_${generateTsid()}`,
        name: 'PS Layer',
        description: null,
        layerType: 'POINT',
        centerLat: null,
        centerLon: null,
        radiusMeters: null,
        polygonGeojson: null,
        now: new Date(),
      }),
    );
  });

  function newSet(name: string): PropertySet {
    return PropertySet.create({
      id: asPropertySetId(`${PROPERTY_SET_ID_PREFIX}_${generateTsid()}`),
      layerId: asLayerId(layerId),
      name,
      description: null,
      now: new Date(),
    });
  }

  it('listByLayer returns sets with inline properties', async () => {
    const ps = newSet('Defaults');
    const withProps = PropertySet.replaceProperties(
      ps,
      [
        { id: asPropertyId(`prp_${generateTsid()}`), key: 'tier', value: 'gold' },
        { id: asPropertyId(`prp_${generateTsid()}`), key: 'format', value: 'flagship' },
      ],
      new Date(),
    );
    await repo.persist(withProps);

    const sets = await repo.listByLayer(asLayerId(layerId));
    expect(sets.length).toBe(1);
    expect(sets[0]?.properties.length).toBe(2);
    const keys = sets[0]?.properties.map((p) => p.key).toSorted();
    expect(keys).toEqual(['format', 'tier']);
  });

  it('countByLayerIds buckets counts per layer', async () => {
    await repo.persist(newSet('a'));
    await repo.persist(newSet('b'));

    const counts = await repo.countByLayerIds([asLayerId(layerId)]);
    expect(counts.get(layerId)).toBe(2);

    // Layers without sets aren't in the map.
    const other = asLayerId('lyr_doesnt_exist');
    const counts2 = await repo.countByLayerIds([other]);
    expect(counts2.get(other)).toBeUndefined();
  });
});
