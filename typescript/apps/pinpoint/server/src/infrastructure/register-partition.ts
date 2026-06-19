import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { PARTITION_TYPE, type Partition } from '../domain/tenancy/partition.js';
import type { PartitionRepository } from '../domain/tenancy/partition.repository.js';

export function registerPartition(
  registry: AggregateRegistryImpl,
  repository: PartitionRepository,
): void {
  registry.register(createAggregateHandler<Partition>(PARTITION_TYPE, repository));
}
