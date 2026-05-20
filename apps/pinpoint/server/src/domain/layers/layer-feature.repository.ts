import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { LayerFeature } from './layer-feature.js';
import type { LayerFeatureId, LayerId } from './ids.js';

export interface ListLayerFeaturesQuery {
  readonly layerId: LayerId;
  readonly limit: number;
  readonly offset: number;
}

export interface ListLayerFeaturesResult {
  readonly features: readonly LayerFeature[];
  readonly total: number;
}

export interface LayerFeatureRepository {
  persist(aggregate: LayerFeature, tx?: TransactionContext): Promise<LayerFeature>;
  delete(aggregate: LayerFeature, tx?: TransactionContext): Promise<boolean>;

  findById(id: LayerFeatureId): Promise<LayerFeature | null>;
  listByLayer(query: ListLayerFeaturesQuery): Promise<ListLayerFeaturesResult>;
}
