import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { LayerFeature, LayerFeatureProperties } from './layer-feature.js';
import type { LayerFeatureId, LayerId } from './ids.js';
import type { ClientId, PartitionId } from '../tenancy/ids.js';

export interface ListLayerFeaturesQuery {
  readonly layerId: LayerId;
  readonly limit: number;
  readonly offset: number;
}

export interface ListLayerFeaturesResult {
  readonly features: readonly LayerFeature[];
  readonly total: number;
}

export interface SpatialLookupQuery {
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly layerCodes: readonly string[] | null;
}

export interface SpatialLookupHit {
  readonly layerId: string;
  readonly layerCode: string;
  readonly layerName: string;
  readonly layerType: 'RADIUS' | 'POLYGON' | 'POINT';
  readonly featureId: string;
  readonly featureLabel: string;
  /** Non-null only for POINT layers (nearest-feature distance). */
  readonly distanceMeters: number | null;
  readonly propertyValues: LayerFeatureProperties;
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
  /** Polygon vertices as "lng,lat;lng,lat;…" string — parsed from WKT for POLYGON layers. */
  readonly polygonPoints: string | null;
}

export interface LocationFeatureAssociationInput {
  readonly layerId: string;
  readonly featureId: string;
  readonly distanceMeters: number | null;
}

export interface FeatureAssociation {
  readonly layerFeatureId: string;
  readonly layerId: string;
  readonly layerName: string;
  readonly featureLabel: string;
  /** Non-null only for POINT-layer associations (nearest-feature distance). */
  readonly distanceMeters: number | null;
}

export interface LayerFeatureRepository {
  persist(aggregate: LayerFeature, tx?: TransactionContext): Promise<LayerFeature>;
  delete(aggregate: LayerFeature, tx?: TransactionContext): Promise<boolean>;

  findById(id: LayerFeatureId): Promise<LayerFeature | null>;
  listByLayer(query: ListLayerFeaturesQuery): Promise<ListLayerFeaturesResult>;

  /**
   * Spatial lookup at a coordinate. Returns all layer features that contain
   * the point (RADIUS/POLYGON via `ST_Intersects(boundary, point)`) plus the
   * nearest active POINT-layer feature per layer. Optionally restricted by
   * partition and/or layer codes.
   */
  spatialLookup(query: SpatialLookupQuery): Promise<readonly SpatialLookupHit[]>;

  /**
   * Replace all `location_feature_associations` rows for a location with
   * the provided set. Used by `confirm-master-location` (cascading
   * spatial features down to child locations) and by `create-location`
   * when a created location matches an already-validated master.
   *
   * Wraps the operation in a tx so partial writes can't leak.
   */
  replaceLocationFeatureAssociations(
    locationId: string,
    associations: readonly LocationFeatureAssociationInput[],
    tx?: TransactionContext,
  ): Promise<void>;

  /**
   * The persisted `location_feature_associations` rows for a location,
   * joined with layer + feature label for display. Used by the BFF
   * location detail. Ordered by layer name + label.
   */
  findFeatureAssociations(locationId: string): Promise<readonly FeatureAssociation[]>;

  /**
   * Direct status flip for a feature (ACTIVE/INACTIVE), used by the BFF
   * `PUT /features/:id/status` endpoint. Mirror of Rust's
   * `update_status` repo method — no aggregate commit, no event. If
   * audit coverage becomes a real requirement, swap to a dedicated
   * use case.
   */
  setStatus(featureId: LayerFeatureId, status: 'ACTIVE' | 'INACTIVE'): Promise<void>;

  /**
   * Containment-only spatial lookup — features whose boundary contains
   * the point via `ST_Intersects`. Excludes the POINT-nearest half of
   * `spatialLookup`. Used by the BFF `match-features` endpoints (single
   * + bulk) to re-associate child locations with their matched
   * features. `distanceMeters` is always null in the result (it's a
   * containment match, not a distance match).
   */
  findFeaturesContainingPoint(
    query: FindFeaturesContainingPointQuery,
  ): Promise<readonly FeatureAssociation[]>;
}

export interface FindFeaturesContainingPointQuery {
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  readonly latitude: number;
  readonly longitude: number;
}
