/** Seed helpers shared by the operator-action use-case tests (2026-08-22 slice). */
import { generateTsid } from '@flowcatalyst/sdk';
import { isSuccess } from '@pinpoint/framework';
import type { AppContext } from '../../../src/app-context.js';
import { Layer } from '../../../src/domain/layers/layer.js';
import { LayerFeature } from '../../../src/domain/layers/layer-feature.js';
import {
  asLayerFeatureId,
  asLayerId,
  LAYER_FEATURE_ID_PREFIX,
  LAYER_ID_PREFIX,
} from '../../../src/domain/layers/ids.js';
import { asClientId, asPartitionId, type ClientId } from '../../../src/domain/tenancy/ids.js';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import { Location } from '../../../src/domain/locations/location.js';
import {
  asLocationId,
  asMasterLocationId,
  LOCATION_ID_PREFIX,
  MASTER_LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { runInScope } from '../test-app-context.js';

export async function seedClient(
  appContext: AppContext,
): Promise<{ clientId: ClientId; defaultPartitionId: string }> {
  const c = await runInScope({ sub: 'prn_test' }, () =>
    appContext.runWrite(() =>
      appContext.useCases.createClient.execute({ name: 'Acme', code: `ACME_${generateTsid()}` }),
    ),
  );
  if (!isSuccess(c)) throw new Error('client setup failed');
  const clientId = asClientId(c.value.getData().clientId);
  const def = await appContext.repositories.partitions.findByClientAndCode(clientId, 'default');
  if (!def) throw new Error('default partition missing');
  return { clientId, defaultPartitionId: def.id };
}

export async function seedLayerWithRadiusFeature(
  appContext: AppContext,
  clientId: ClientId,
  center: { lat: number; lon: number },
): Promise<{ layerId: string; featureId: string }> {
  const now = new Date();
  const layerId = asLayerId(`${LAYER_ID_PREFIX}_${generateTsid()}`);
  await appContext.repositories.layers.persist(
    Layer.create({
      id: layerId,
      clientId,
      code: `L_${generateTsid()}`,
      name: 'Zones',
      description: null,
      layerType: 'RADIUS',
      centerLat: center.lat,
      centerLon: center.lon,
      radiusMeters: 5000,
      polygonGeojson: null,
      now,
    }),
  );
  const featureId = asLayerFeatureId(`${LAYER_FEATURE_ID_PREFIX}_${generateTsid()}`);
  await appContext.repositories.layerFeatures.persist(
    LayerFeature.create({
      id: featureId,
      layerId,
      label: 'CBD',
      centerLat: center.lat,
      centerLon: center.lon,
      radiusMeters: 5000,
      polygonGeojson: null,
      propertyValues: { zone: 'cbd' },
      now,
    }),
  );
  return { layerId, featureId };
}

export async function seedGeocodedMasterWithChild(
  appContext: AppContext,
  clientId: ClientId,
  partitionId: string,
  coords: { lat: number; lon: number },
): Promise<{ masterLocationId: string; locationId: string }> {
  const now = new Date();
  const masterId = asMasterLocationId(`${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`);
  const pending = MasterLocation.create({
    id: masterId,
    clientId,
    partitionId: asPartitionId(partitionId),
    normalizedHouseNumber: '12',
    normalizedRoad: 'Long Street',
    normalizedSuburb: null,
    normalizedCity: 'Cape Town',
    normalizedState: null,
    normalizedPostalCode: null,
    normalizedCountry: 'South Africa',
    addressHash: `hash-${generateTsid()}`,
    normalizedAddressLine: '12 Long Street, Cape Town, South Africa',
    now,
  });
  await appContext.repositories.masterLocations.persist(
    MasterLocation.geocoded(pending, { latitude: coords.lat, longitude: coords.lon }, now),
  );
  const locationId = asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`);
  const loc = Location.create({
    id: locationId,
    clientId,
    partitionId: asPartitionId(partitionId),
    externalId: null,
    name: 'Shop',
    rawAddressLine1: '12 Long Street',
    rawAddressLine2: null,
    rawSuburb: null,
    rawCity: 'Cape Town',
    rawState: null,
    rawPostalCode: null,
    rawCountry: 'South Africa',
    now,
  });
  await appContext.repositories.locations.persist({ ...loc, masterLocationId: masterId });
  return { masterLocationId: masterId, locationId };
}
