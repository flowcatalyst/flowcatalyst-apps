import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { Location } from './location.js';
import type { LocationId, MasterLocationId } from './ids.js';

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
  findByExternalId(
    clientId: ClientId,
    partitionId: PartitionId | null,
    externalId: string,
  ): Promise<Location | null>;
  listByMaster(masterLocationId: MasterLocationId): Promise<readonly Location[]>;
  listByClient(query: ListByClientQuery): Promise<ListByClientResult>;
}

