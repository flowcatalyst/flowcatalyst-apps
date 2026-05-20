import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { LAYER_TYPE, type Layer } from '../domain/layers/layer.js';
import type { LayerRepository } from '../domain/layers/layer.repository.js';

export function registerLayer(
  registry: AggregateRegistryImpl,
  repository: LayerRepository,
): void {
  registry.register(createAggregateHandler<Layer>(LAYER_TYPE, repository));
}
