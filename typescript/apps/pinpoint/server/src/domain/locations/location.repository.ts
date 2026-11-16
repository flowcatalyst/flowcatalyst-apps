import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { Location, LocationStatus } from './location.js';
import type { LocationId, MasterLocationId } from './ids.js';

export interface ListByClientQuery {
  readonly clientId: ClientId;
  /** Narrow to one partition when set. */
  readonly partitionId?: PartitionId | null;
  readonly status?: LocationStatus | undefined;
  /** Free-text filter: case-insensitive contains over the searchable text columns. */
  readonly search?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface ListByClientResult {
  readonly locations: readonly Location[];
  readonly total: number;
}

/**
 * The review queue: locations awaiting a person — not yet geocoded, geocoded
 * but not auto-approved, or flagged by a delivery capture. `visibleTo` null =
 * every client; otherwise the granted partitions plus partition-less
 * locations of the granted clients.
 */
export interface ReviewQueueQuery {
  readonly visibleTo: {
    readonly partitionIds: readonly string[];
    readonly clientIds: readonly string[];
  } | null;
  readonly clientIds?: readonly ClientId[] | undefined;
  readonly partitionIds?: readonly PartitionId[] | undefined;
  /** Narrow to one reason. */
  readonly reason?: 'PENDING' | 'GEOCODED' | 'CAPTURE_DISAGREES' | undefined;
  readonly limit: number;
  readonly offset: number;
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
  /** A client's location with this address hash (any partition when `partitionId` is undefined). */
  findByHash(
    clientId: ClientId,
    partitionId: PartitionId | null | undefined,
    addressHash: string,
  ): Promise<Location | null>;
  /** A client's locations closest to `addressLine` by trigram similarity of the match address. */
  findFuzzyCandidates(
    clientId: ClientId,
    partitionId: PartitionId | null | undefined,
    addressLine: string,
    threshold: number,
    limit: number,
  ): Promise<readonly Location[]>;
  /** Locations whose data was copied from this master (reference only). */
  listBySourceMaster(masterLocationId: MasterLocationId): Promise<readonly Location[]>;
  listByClient(query: ListByClientQuery): Promise<ListByClientResult>;
  listByStatus(status: LocationStatus, limit: number): Promise<readonly Location[]>;
  /** Locations whose cached third-party geocode expires before `cutoff`, soonest first. */
  listGeocodesExpiringBefore(cutoff: Date, limit: number): Promise<readonly Location[]>;
  listReviewQueue(
    query: ReviewQueueQuery,
  ): Promise<{ readonly locations: readonly Location[]; readonly total: number }>;
  /** Total locations across all clients (dashboard). */
  count(): Promise<number>;
}
