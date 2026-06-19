import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { MasterLocation, MasterLocationStatus } from './master-location.js';
import type { MasterLocationId } from './ids.js';

export interface ListMasterLocationsQuery {
  readonly clientId: ClientId;
  readonly status?: MasterLocationStatus | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface ListMasterLocationsResult {
  readonly masters: readonly MasterLocation[];
  readonly total: number;
}

export interface ApplyConfirmedGeocodeInput {
  readonly masterLocationId: MasterLocationId;
  readonly normalizedHouseNumber: string | null;
  readonly normalizedRoad: string | null;
  readonly normalizedSuburb: string | null;
  readonly normalizedCity: string;
  readonly normalizedState: string | null;
  readonly normalizedPostalCode: string | null;
  readonly normalizedCountry: string;
  readonly addressHash: string;
  readonly normalizedAddressLine: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface FindUnvalidatedQuery {
  readonly clientIds: readonly ClientId[] | null;
  readonly partitionIds: readonly PartitionId[] | null;
  readonly limit: number;
  readonly offset: number;
  readonly ascending: boolean;
}

export interface FindUnvalidatedResult {
  readonly masters: readonly MasterLocation[];
  readonly total: number;
}

export interface MasterLocationRepository {
  persist(aggregate: MasterLocation, tx?: TransactionContext): Promise<MasterLocation>;
  delete(aggregate: MasterLocation, tx?: TransactionContext): Promise<boolean>;
  findById(id: MasterLocationId): Promise<MasterLocation | null>;
  findByHash(
    clientId: ClientId,
    partitionId: PartitionId | null,
    addressHash: string,
  ): Promise<MasterLocation | null>;
  findFuzzyCandidates(
    clientId: ClientId,
    partitionId: PartitionId | null,
    addressLine: string,
    threshold: number,
    limit: number,
  ): Promise<readonly MasterLocation[]>;
  listByClient(query: ListMasterLocationsQuery): Promise<ListMasterLocationsResult>;
  listByStatus(status: MasterLocationStatus, limit: number): Promise<readonly MasterLocation[]>;
  findUnvalidated(query: FindUnvalidatedQuery): Promise<FindUnvalidatedResult>;
  applyConfirmedGeocode(input: ApplyConfirmedGeocodeInput): Promise<void>;
}
