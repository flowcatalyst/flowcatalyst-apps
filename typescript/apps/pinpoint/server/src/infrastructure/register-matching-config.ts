import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { MATCHING_CONFIG_TYPE, type MatchingConfig } from '../domain/matching/matching-config.js';
import type { MatchingConfigRepository } from '../domain/matching/matching-config.repository.js';

export function registerMatchingConfig(
  registry: AggregateRegistryImpl,
  repository: MatchingConfigRepository,
): void {
  registry.register(createAggregateHandler<MatchingConfig>(MATCHING_CONFIG_TYPE, repository));
}
