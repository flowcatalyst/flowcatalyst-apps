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
}
