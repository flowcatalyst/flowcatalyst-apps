import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { FULFILMENT_TYPE, type Fulfilment } from '../domain/fulfilments/fulfilment.js';
import type { FulfilmentRepository } from '../domain/fulfilments/fulfilment.repository.js';

/**
 * Wire the Fulfilment aggregate (including its parts — they persist inside
 * the same repository call) into the shared AggregateRegistry.
 */
export function registerFulfilment(
  registry: AggregateRegistryImpl,
  repository: FulfilmentRepository,
): void {
  registry.register(createAggregateHandler<Fulfilment>(FULFILMENT_TYPE, repository));
}
