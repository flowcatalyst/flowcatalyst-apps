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
}
