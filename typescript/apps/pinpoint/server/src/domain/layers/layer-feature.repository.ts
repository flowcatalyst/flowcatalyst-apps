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
  readonly distanceMeters: number | null;
  readonly propertyValues: LayerFeatureProperties;
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
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
  readonly distanceMeters: number | null;
}

export interface FindFeaturesContainingPointQuery {
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  readonly latitude: number;
  readonly longitude: number;
}

export interface LayerFeatureRepository {
  persist(aggregate: LayerFeature, tx?: TransactionContext): Promise<LayerFeature>;
  delete(aggregate: LayerFeature, tx?: TransactionContext): Promise<boolean>;

  findById(id: LayerFeatureId): Promise<LayerFeature | null>;
  listByLayer(query: ListLayerFeaturesQuery): Promise<ListLayerFeaturesResult>;
  spatialLookup(query: SpatialLookupQuery): Promise<readonly SpatialLookupHit[]>;
  replaceLocationFeatureAssociations(
    locationId: string,
    associations: readonly LocationFeatureAssociationInput[],
    tx?: TransactionContext,
  ): Promise<void>;
  findFeatureAssociations(locationId: string): Promise<readonly FeatureAssociation[]>;
  setStatus(featureId: LayerFeatureId, status: 'ACTIVE' | 'INACTIVE'): Promise<void>;
  findFeaturesContainingPoint(
    query: FindFeaturesContainingPointQuery,
  ): Promise<readonly FeatureAssociation[]>;
}
