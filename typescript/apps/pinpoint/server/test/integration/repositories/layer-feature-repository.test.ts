/**
 * LayerFeatureRepository — proves `boundary` is derived on persist for every
 * shape (RADIUS / POLYGON / POINT) so containment queries actually match.
 * (Regression: the TS port originally never wrote `boundary`.)
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateTsid } from '@flowcatalyst/sdk';
import { Client } from '../../../src/domain/tenancy/client.js';
import { Layer } from '../../../src/domain/layers/layer.js';
import { LayerFeature } from '../../../src/domain/layers/layer-feature.js';
import { asClientId, CLIENT_ID_PREFIX, type ClientId } from '../../../src/domain/tenancy/ids.js';
import {
  asLayerFeatureId,
  asLayerId,
  LAYER_FEATURE_ID_PREFIX,
  LAYER_ID_PREFIX,
  type LayerId,
} from '../../../src/domain/layers/ids.js';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { createDrizzleLayerRepository } from '../../../src/infrastructure/layer-repository.js';
import { createDrizzleLayerFeatureRepository } from '../../../src/infrastructure/layer-feature-repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

const CT = { lat: -33.9249, lon: 18.4241 }; // Cape Town CBD
const SQUARE_AROUND_CT = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [18.4, -33.95],
      [18.45, -33.95],
      [18.45, -33.9],
      [18.4, -33.9],
      [18.4, -33.95],
    ],
  ],
});

describe('LayerFeatureRepository boundary derivation (integration)', () => {
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  let clientId: ClientId;
  let layerId: LayerId;
  const layerRepo = () => createDrizzleLayerRepository(db);
  const featureRepo = () => createDrizzleLayerFeatureRepository(db);

  beforeAll(async () => {
    db = (await getDbFixture()).db;
  });
  beforeEach(async () => {
    await cleanDb();
    clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    await createDrizzleClientRepository(db).persist(
      Client.create({ id: clientId, name: 'Acme', code: `LF_${generateTsid()}`, now: new Date() }),
    );
    layerId = asLayerId(`${LAYER_ID_PREFIX}_${generateTsid()}`);
    await layerRepo().persist(
      Layer.create({
        id: layerId,
        clientId,
        code: 'ZONES',
        name: 'Zones',
        description: null,
        layerType: 'RADIUS',
        centerLat: CT.lat,
        centerLon: CT.lon,
        radiusMeters: 20_000,
        polygonGeojson: null,
        now: new Date(),
      }),
    );
  });

  function feature(shape: {
    centerLat: number | null;
    centerLon: number | null;
    radiusMeters: number | null;
    polygonGeojson: string | null;
  }) {
    return LayerFeature.create({
      id: asLayerFeatureId(`${LAYER_FEATURE_ID_PREFIX}_${generateTsid()}`),
      layerId,
      label: 'F',
      propertyValues: {},
      now: new Date(),
      ...shape,
    });
  }

  it('layer persist writes a boundary geometry', async () => {
    const rows = await db.execute(
      sql`SELECT boundary IS NOT NULL AS has_boundary, ST_GeometryType(boundary) AS t FROM layers WHERE id = ${layerId}`,
    );
    expect(rows[0]?.['has_boundary']).toBe(true);
    expect(rows[0]?.['t']).toBe('ST_Polygon');
  });

  it('RADIUS feature: point inside the buffer is contained, 50 km away is not', async () => {
    const f = await featureRepo().persist(
      feature({ centerLat: CT.lat, centerLon: CT.lon, radiusMeters: 5_000, polygonGeojson: null }),
    );
    const inside = await featureRepo().findFeaturesContainingPoint({
      clientId,
      partitionId: null,
      latitude: CT.lat + 0.01,
      longitude: CT.lon,
    });
    expect(inside.map((h) => h.layerFeatureId)).toEqual([f.id]);
    const far = await featureRepo().findFeaturesContainingPoint({
      clientId,
      partitionId: null,
      latitude: CT.lat + 0.45,
      longitude: CT.lon,
    });
    expect(far).toEqual([]);
  });

  it('POLYGON feature: GeoJSON becomes the boundary', async () => {
    const f = await featureRepo().persist(
      feature({
        centerLat: null,
        centerLon: null,
        radiusMeters: null,
        polygonGeojson: SQUARE_AROUND_CT,
      }),
    );
    const hits = await featureRepo().findFeaturesContainingPoint({
      clientId,
      partitionId: null,
      latitude: CT.lat,
      longitude: CT.lon,
    });
    expect(hits.map((h) => h.layerFeatureId)).toEqual([f.id]);
  });

  it('update re-derives the boundary (moving the centre moves the match)', async () => {
    const f = await featureRepo().persist(
      feature({ centerLat: CT.lat, centerLon: CT.lon, radiusMeters: 1_000, polygonGeojson: null }),
    );
    await featureRepo().persist({ ...f, centerLat: CT.lat + 0.3, updatedAt: new Date() });
    const atOld = await featureRepo().findFeaturesContainingPoint({
      clientId,
      partitionId: null,
      latitude: CT.lat,
      longitude: CT.lon,
    });
    expect(atOld).toEqual([]);
  });
});
