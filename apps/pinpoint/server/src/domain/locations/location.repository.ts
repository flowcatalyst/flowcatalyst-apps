import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { Location } from './location.js';
import type { LocationId } from './ids.js';

export interface ListByClientQuery {
  readonly clientId: ClientId;
  readonly limit: number;
  readonly offset: number;
}

export interface ListByClientResult {
  readonly locations: readonly Location[];
  readonly total: number;
}

export interface LocationRepository {
  persist(aggregate: Location, tx?: TransactionContext): Promise<Location>;
  delete(aggregate: Location, tx?: TransactionContext): Promise<boolean>;

  findById(id: LocationId): Promise<Location | null>;

  /**
   * Dedup lookup used by `create-location` when an `externalId` is supplied.
   * Scoped to (clientId, partitionId | null) per the partial-unique index
   * `idx_locations_external_id`.
   */
  findByExternalId(
    clientId: ClientId,
    partitionId: PartitionId | null,
    externalId: string,
  ): Promise<Location | null>;

  listByClient(query: ListByClientQuery): Promise<ListByClientResult>;
}
