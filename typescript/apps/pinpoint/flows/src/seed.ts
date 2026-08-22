import type { Api } from './client.js';
import { ok } from './client.js';
import type { Report } from './report.js';

/** Cape Town CBD — the anchor for the seeded geography. */
export const CBD = { lat: -33.9249, lon: 18.4241 };
export const SEA_POINT = { lat: -33.9166, lon: 18.3845 };
export const STELLENBOSCH = { lat: -33.9321, lon: 18.8602 };

const CBD_POLYGON = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [18.41, -33.935],
      [18.44, -33.935],
      [18.44, -33.91],
      [18.41, -33.91],
      [18.41, -33.935],
    ],
  ],
});

export interface Seeded {
  readonly clientId: string;
  readonly clientCode: string;
  readonly defaultPartitionId: string;
  readonly westernCapePartitionId: string;
  readonly layerId: string;
  readonly features: { cbd: string; seaPoint: string; stellenbosch: string };
}

export async function seed(api: Api, r: Report, runTag: string): Promise<Seeded> {
  const clientCode = `FLOWDEMO_${runTag}`;
  const client = await ok(
    api.POST('/bff/clients', { body: { name: `Flow demo ${runTag}`, code: clientCode } }),
  );
  const clientId = client.id;
  r.note(`client ${clientId} (${clientCode})`);

  const partitions = await ok(
    api.GET('/bff/clients/{clientId}/partitions', { params: { path: { clientId } } }),
  );
  const def = partitions.items.find((p) => p.code === 'default');
  if (!def) throw new Error('default partition was not seeded by create-client');
  const wc = await ok(
    api.POST('/bff/clients/{clientId}/partitions', {
      params: { path: { clientId } },
      body: { code: 'western-cape', name: 'Western Cape', description: 'Regional partition' },
    }),
  );
  r.note(`partitions default=${def.id} western-cape=${wc.id}`);

  const layer = await ok(
    api.POST('/bff/clients/{clientId}/layers', {
      params: { path: { clientId } },
      body: {
        code: 'ZONES',
        name: 'Delivery zones',
        description: 'Demo zones around Cape Town',
        layerType: 'RADIUS',
        centerLat: CBD.lat,
        centerLon: CBD.lon,
        radius: 60_000,
        geometry: null,
      },
    }),
  );
  const layerId = layer.id;
  const mkFeature = async (
    label: string,
    shape: {
      centerLat: number | null;
      centerLon: number | null;
      radiusMeters: number | null;
      polygonGeojson: string | null;
    },
    propertyValues: Record<string, string>,
  ) =>
    (
      await ok(
        api.POST('/bff/clients/{clientId}/layers/{layerId}/features', {
          params: { path: { clientId, layerId } },
          body: { label, ...shape, propertyValues },
        }),
      )
    ).id;
  const cbd = await mkFeature(
    'CBD',
    { centerLat: null, centerLon: null, radiusMeters: null, polygonGeojson: CBD_POLYGON },
    { zone: 'cbd', depot: 'woodstock' },
  );
  const seaPoint = await mkFeature(
    'Sea Point',
    {
      centerLat: SEA_POINT.lat,
      centerLon: SEA_POINT.lon,
      radiusMeters: 1_500,
      polygonGeojson: null,
    },
    { zone: 'atlantic', depot: 'woodstock' },
  );
  const stellenbosch = await mkFeature(
    'Stellenbosch',
    {
      centerLat: STELLENBOSCH.lat,
      centerLon: STELLENBOSCH.lon,
      radiusMeters: 5_000,
      polygonGeojson: null,
    },
    { zone: 'winelands', depot: 'stellenbosch' },
  );
  r.note(`layer ${layerId} with features CBD(polygon) / Sea Point(1.5 km) / Stellenbosch(5 km)`);

  const ps = await ok(
    api.POST('/bff/clients/{clientId}/layers/{layerId}/property-sets', {
      params: { path: { clientId, layerId } },
      body: { name: 'delivery', description: 'Delivery attributes' },
    }),
  );
  await ok(
    api.PUT('/bff/clients/{clientId}/layers/{layerId}/property-sets/{propertySetId}/properties', {
      params: { path: { clientId, layerId, propertySetId: ps.id } },
      body: {
        properties: [
          { key: 'sla_hours', value: '24' },
          { key: 'vehicle', value: 'van' },
        ],
      },
    }),
  );
  r.note(`property set ${ps.id} (sla_hours, vehicle)`);

  await ok(
    api.PUT('/bff/clients/{clientId}/matching-config', {
      params: { path: { clientId } },
      body: {
        streetThreshold: 0.85,
        houseNumberThreshold: 1,
        postalCodeThreshold: 0.95,
        stateThreshold: 0.9,
        addressNameThreshold: 0.8,
        overallThreshold: 0.85,
      },
    }),
  );
  r.note('matching config: defaults written as a client override');

  return {
    clientId,
    clientCode,
    defaultPartitionId: def.id,
    westernCapePartitionId: wc.id,
    layerId,
    features: { cbd, seaPoint, stellenbosch },
  };
}
