import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
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

export interface LayerFeaturesService {
  readonly persist: (
    aggregate: LayerFeature,
    tx?: TransactionContext,
  ) => Effect.Effect<LayerFeature, InfrastructureError>;
  readonly delete: (
    aggregate: LayerFeature,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
  readonly findById: (
    id: LayerFeatureId,
  ) => Effect.Effect<LayerFeature | null, InfrastructureError>;
  readonly listByLayer: (
    query: ListLayerFeaturesQuery,
  ) => Effect.Effect<ListLayerFeaturesResult, InfrastructureError>;
  readonly spatialLookup: (
    query: SpatialLookupQuery,
  ) => Effect.Effect<readonly SpatialLookupHit[], InfrastructureError>;
  readonly replaceLocationFeatureAssociations: (
    locationId: string,
    associations: readonly LocationFeatureAssociationInput[],
    tx?: TransactionContext,
  ) => Effect.Effect<void, InfrastructureError>;
  readonly findFeatureAssociations: (
    locationId: string,
  ) => Effect.Effect<readonly FeatureAssociation[], InfrastructureError>;
  readonly setStatus: (
    featureId: LayerFeatureId,
    status: 'ACTIVE' | 'INACTIVE',
  ) => Effect.Effect<void, InfrastructureError>;
  readonly findFeaturesContainingPoint: (
    query: FindFeaturesContainingPointQuery,
  ) => Effect.Effect<readonly FeatureAssociation[], InfrastructureError>;
}

export class LayerFeatures extends Context.Service<
  LayerFeatures,
  LayerFeaturesService
>()('@pinpoint/server/LayerFeatures') {
  static layer(port: LayerFeatureRepository): Layer.Layer<LayerFeatures> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `LAYER_FEATURE_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(LayerFeatures, {
      persist: wrap('PERSIST', port.persist.bind(port)),
      delete: wrap('DELETE', port.delete.bind(port)),
      findById: wrap('READ', port.findById.bind(port)),
      listByLayer: wrap('LIST', port.listByLayer.bind(port)),
      spatialLookup: wrap('SPATIAL', port.spatialLookup.bind(port)),
      replaceLocationFeatureAssociations: wrap(
        'REPLACE_ASSOC',
        port.replaceLocationFeatureAssociations.bind(port),
      ),
      findFeatureAssociations: wrap('READ', port.findFeatureAssociations.bind(port)),
      setStatus: wrap('WRITE', port.setStatus.bind(port)),
      findFeaturesContainingPoint: wrap(
        'SPATIAL',
        port.findFeaturesContainingPoint.bind(port),
      ),
    });
  }
}
