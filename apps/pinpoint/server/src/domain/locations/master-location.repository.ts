import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { MasterLocation } from './master-location.js';
import type { MasterLocationId } from './ids.js';

export interface ListMasterLocationsQuery {
  readonly clientId: ClientId;
  readonly limit: number;
  readonly offset: number;
}

export interface ListMasterLocationsResult {
  readonly masters: readonly MasterLocation[];
  readonly total: number;
}

export interface MasterLocationRepository {
  persist(aggregate: MasterLocation, tx?: TransactionContext): Promise<MasterLocation>;
  delete(aggregate: MasterLocation, tx?: TransactionContext): Promise<boolean>;

  findById(id: MasterLocationId): Promise<MasterLocation | null>;

  /**
   * Exact-hash lookup scoped to (client, partition). Returns the master
   * row whose `address_hash` matches, regardless of status — callers
   * filter by status (matching pipeline considers only VALIDATED masters
   * for matching, mirroring the Rust pattern).
   */
  findByHash(
    clientId: ClientId,
    partitionId: PartitionId | null,
    addressHash: string,
  ): Promise<MasterLocation | null>;

  /**
   * pg_trgm fuzzy candidate search via `normalized_address_line %> $1`,
   * returning up to `limit` rows ordered by trigram similarity. Threshold
   * defaults to 0.3 (Rust default); callers retain the option to filter
   * the result by status.
   */
  findFuzzyCandidates(
    clientId: ClientId,
    partitionId: PartitionId | null,
    addressLine: string,
    threshold: number,
    limit: number,
  ): Promise<readonly MasterLocation[]>;

  /** All locations associated with this master — used by confirm cascade. */
  listByClient(query: ListMasterLocationsQuery): Promise<ListMasterLocationsResult>;
}
