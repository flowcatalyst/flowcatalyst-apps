import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { PICK_TYPE, type Pick } from '../domain/picks/pick.js';
import type { PickRepository } from '../domain/picks/pick.repository.js';

/**
 * Wire the Pick aggregate into the shared AggregateRegistry so
 * `commitAggregate(pick, ...)` resolves to this repository at persist time.
 */
export function registerPick(registry: AggregateRegistryImpl, repository: PickRepository): void {
  registry.register(createAggregateHandler<Pick>(PICK_TYPE, repository));
}
