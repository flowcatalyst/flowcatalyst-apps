import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { Location } from './location.js';
import type { LocationId, MasterLocationId } from './ids.js';

export interface ListByClientQuery {
  readonly clientId: ClientId;
  /** Narrow to one partition when set. */
  readonly partitionId?: PartitionId | null;
  /** Free-text filter: case-insensitive contains over the searchable text columns. */
  readonly search?: string | undefined;
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
  findByExternalId(
    clientId: ClientId,
    partitionId: PartitionId | null,
    externalId: string,
  ): Promise<Location | null>;
  listByMaster(masterLocationId: MasterLocationId): Promise<readonly Location[]>;
  listByClient(query: ListByClientQuery): Promise<ListByClientResult>;
  /** Total locations across all clients (dashboard). */
  count(): Promise<number>;
}
