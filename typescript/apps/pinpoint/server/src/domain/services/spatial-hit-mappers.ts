/**
 * Shared mappers from a PostGIS `SpatialLookupHit` to the two shapes the
 * matching pipeline needs: the `LocationValidated` event's per-feature
 * `LayerPropertyAssignment`, and the persisted `LocationFeatureAssociationInput`
 * row. Used by both create-location and rematch-location so a rematch that
 * lands on a validated master emits the same feature-property payload a fresh
 * create would.
 */
import type { LayerPropertyAssignment } from '../locations/events/location-validated.event.js';
import type {
  LocationFeatureAssociationInput,
  SpatialLookupHit,
} from '../layers/layer-feature.repository.js';

export function hitToProperty(hit: SpatialLookupHit): LayerPropertyAssignment {
  return {
    layerId: hit.layerId,
    layerCode: hit.layerCode,
    layerName: hit.layerName,
    layerType: hit.layerType,
    featureId: hit.featureId,
    featureLabel: hit.featureLabel,
    distanceMeters: hit.distanceMeters,
    geometry: {
      geometryType: hit.layerType,
      longitude: hit.centerLon,
      latitude: hit.centerLat,
      radiusMeters: hit.radiusMeters,
      polygonPoints:
        hit.polygonPoints !== null
          ? hit.polygonPoints
              .split(';')
              .map((p) => p.split(','))
              .filter((parts) => parts.length === 2)
              .map((parts): [number, number] => [Number(parts[0]), Number(parts[1])])
          : null,
    },
    properties: Object.entries(hit.propertyValues).map(([key, value]) => ({ key, value })),
  };
}

export function hitToAssociation(hit: SpatialLookupHit): LocationFeatureAssociationInput {
  return {
    layerId: hit.layerId,
    featureId: hit.featureId,
    distanceMeters: hit.distanceMeters,
  };
}
