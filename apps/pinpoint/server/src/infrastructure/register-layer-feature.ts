import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { LAYER_FEATURE_TYPE, type LayerFeature } from '../domain/layers/layer-feature.js';
import type { LayerFeatureRepository } from '../domain/layers/layer-feature.repository.js';

export function registerLayerFeature(
  registry: AggregateRegistryImpl,
  repository: LayerFeatureRepository,
): void {
  registry.register(createAggregateHandler<LayerFeature>(LAYER_FEATURE_TYPE, repository));
}
