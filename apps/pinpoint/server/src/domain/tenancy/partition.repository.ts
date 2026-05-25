import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Partition } from './partition.js';
import type { ClientId, PartitionId } from './ids.js';

export interface PartitionRepository {
  persist(aggregate: Partition, tx?: TransactionContext): Promise<Partition>;
  delete(aggregate: Partition, tx?: TransactionContext): Promise<boolean>;

  findById(id: PartitionId): Promise<Partition | null>;
  findByClientAndCode(clientId: ClientId, code: string): Promise<Partition | null>;
  listByClient(clientId: ClientId): Promise<readonly Partition[]>;
}

