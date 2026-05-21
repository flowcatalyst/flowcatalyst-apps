import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId } from '../tenancy/ids.js';
import type { Layer } from './layer.js';
import type { LayerId } from './ids.js';

export interface ListLayersQuery {
  readonly clientId: ClientId;
  readonly limit: number;
  readonly offset: number;
}

export interface ListLayersResult {
  readonly layers: readonly Layer[];
  readonly total: number;
}

export interface LayerRepository {
  persist(aggregate: Layer, tx?: TransactionContext): Promise<Layer>;
  delete(aggregate: Layer, tx?: TransactionContext): Promise<boolean>;

  findById(id: LayerId): Promise<Layer | null>;
  findByClientAndCode(clientId: ClientId, code: string): Promise<Layer | null>;
  listByClient(query: ListLayersQuery): Promise<ListLayersResult>;

  /**
   * Partition assignments for a layer. Empty array = "applies to all
   * partitions" (wildcard semantics). Used by the BFF layer detail and
   * by the matching pipeline's partition-filter clause in spatialLookup.
   */
  findPartitionIds(layerId: LayerId): Promise<readonly string[]>;

  /**
   * Replace the partition assignments for a layer atomically. Empty
   * array = wildcard (apply to all partitions). Mirror of Rust BFF's
   * `set_layer_partitions`.
   */
  setPartitionIds(layerId: LayerId, partitionIds: readonly string[]): Promise<void>;
}
