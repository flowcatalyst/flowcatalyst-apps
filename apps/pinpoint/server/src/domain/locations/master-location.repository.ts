import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
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

export interface MasterLocationsService {
  readonly persist: (
    aggregate: MasterLocation,
    tx?: TransactionContext,
  ) => Effect.Effect<MasterLocation, InfrastructureError>;
  readonly delete: (
    aggregate: MasterLocation,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
  readonly findById: (
    id: MasterLocationId,
  ) => Effect.Effect<MasterLocation | null, InfrastructureError>;
  readonly findByHash: (
    clientId: ClientId,
    partitionId: PartitionId | null,
    addressHash: string,
  ) => Effect.Effect<MasterLocation | null, InfrastructureError>;
  readonly findFuzzyCandidates: (
    clientId: ClientId,
    partitionId: PartitionId | null,
    addressLine: string,
    threshold: number,
    limit: number,
  ) => Effect.Effect<readonly MasterLocation[], InfrastructureError>;
  readonly listByClient: (
    query: ListMasterLocationsQuery,
  ) => Effect.Effect<ListMasterLocationsResult, InfrastructureError>;
  readonly listByStatus: (
    status: MasterLocationStatus,
    limit: number,
  ) => Effect.Effect<readonly MasterLocation[], InfrastructureError>;
  readonly findUnvalidated: (
    query: FindUnvalidatedQuery,
  ) => Effect.Effect<FindUnvalidatedResult, InfrastructureError>;
  readonly applyConfirmedGeocode: (
    input: ApplyConfirmedGeocodeInput,
  ) => Effect.Effect<void, InfrastructureError>;
}

export class MasterLocations extends Context.Service<
  MasterLocations,
  MasterLocationsService
>()('@pinpoint/server/MasterLocations') {
  static layer(port: MasterLocationRepository): Layer.Layer<MasterLocations> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `MASTER_LOCATION_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(MasterLocations, {
      persist: wrap('PERSIST', port.persist.bind(port)),
      delete: wrap('DELETE', port.delete.bind(port)),
      findById: wrap('READ', port.findById.bind(port)),
      findByHash: wrap('READ', port.findByHash.bind(port)),
      findFuzzyCandidates: wrap('FUZZY', port.findFuzzyCandidates.bind(port)),
      listByClient: wrap('LIST', port.listByClient.bind(port)),
      listByStatus: wrap('LIST', port.listByStatus.bind(port)),
      findUnvalidated: wrap('LIST', port.findUnvalidated.bind(port)),
      applyConfirmedGeocode: wrap('APPLY_GEOCODE', port.applyConfirmedGeocode.bind(port)),
    });
  }
}
