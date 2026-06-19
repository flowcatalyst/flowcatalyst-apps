import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { MatchingConfig } from './matching-config.js';
import type { MatchingConfigId } from './ids.js';

export interface MatchingConfigRepository {
  persist(aggregate: MatchingConfig, tx?: TransactionContext): Promise<MatchingConfig>;
  delete(aggregate: MatchingConfig, tx?: TransactionContext): Promise<boolean>;

  findById(id: MatchingConfigId): Promise<MatchingConfig | null>;
  resolve(clientId: ClientId | null, partitionId: PartitionId | null): Promise<MatchingConfig>;
}
