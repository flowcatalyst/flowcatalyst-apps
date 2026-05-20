import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { MatchingConfig } from './matching-config.js';
import type { MatchingConfigId } from './ids.js';

/**
 * Repository contract for MatchingConfig. The aggregate-persistence
 * surface (`persist`/`delete`) is shared with every other aggregate;
 * `resolve` adds the precedence-ordered lookup that mirrors the Rust
 * `resolve_config(client_id, partition_id)`.
 */
export interface MatchingConfigRepository {
  persist(aggregate: MatchingConfig, tx?: TransactionContext): Promise<MatchingConfig>;
  delete(aggregate: MatchingConfig, tx?: TransactionContext): Promise<boolean>;

  findById(id: MatchingConfigId): Promise<MatchingConfig | null>;

  /**
   * Resolve the most-specific config for the (client, partition) tuple.
   * Order: (client, partition) → (client, NULL) → (NULL, NULL = global
   * default). Always returns a config — the seeded global default
   * guarantees the bottom of the cascade is non-null.
   */
  resolve(
    clientId: ClientId | null,
    partitionId: PartitionId | null,
  ): Promise<MatchingConfig>;
}
