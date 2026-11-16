/**
 * The spatial step every path to VALIDATED shares: look up the layer features
 * at the location's own point, replace its feature associations, and build
 * the `location:validated` payload (which carries the layer properties).
 */
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Scope } from '@pinpoint/framework';
import type { Location } from '../locations/location.js';
import type {
  LayerFeatureRepository,
  SpatialLookupHit,
} from '../layers/layer-feature.repository.js';
import { addressDetailsFromLocation } from '../locations/events/address-details.js';
import { LocationValidated } from '../locations/events/location-validated.event.js';
import { hitToAssociation, hitToProperty } from './spatial-hit-mappers.js';

/** Re-associate a located location's features. Returns the hits (empty without coordinates). */
export async function associateLocationFeatures(
  layerFeatures: LayerFeatureRepository,
  location: Location,
  tx: TransactionContext | undefined,
): Promise<readonly SpatialLookupHit[]> {
  const hits =
    location.latitude !== null && location.longitude !== null
      ? await layerFeatures.spatialLookup({
          clientId: location.clientId,
          partitionId: location.partitionId,
          latitude: location.latitude,
          longitude: location.longitude,
          layerCodes: null,
        })
      : [];
  await layerFeatures.replaceLocationFeatureAssociations(
    location.id,
    hits.map(hitToAssociation),
    tx,
  );
  return hits;
}

/** The `location:validated` event for an approved (or matched) location. */
export function locationValidatedEvent(
  scope: Scope,
  location: Location,
  hits: readonly SpatialLookupHit[],
): LocationValidated {
  return new LocationValidated(scope, {
    locationId: location.id,
    clientId: location.clientId,
    sourceMasterLocationId: location.sourceMasterLocationId,
    latitude: location.latitude ?? 0,
    longitude: location.longitude ?? 0,
    geocodeSource: location.geocodeSource ?? 'PHOTON',
    address: addressDetailsFromLocation(location),
    layerProperties: hits.map(hitToProperty),
  });
}
