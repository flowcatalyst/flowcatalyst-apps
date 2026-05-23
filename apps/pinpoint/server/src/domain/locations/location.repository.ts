import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
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

export interface LocationsService {
  readonly persist: (
    aggregate: Location,
    tx?: TransactionContext,
  ) => Effect.Effect<Location, InfrastructureError>;
  readonly delete: (
    aggregate: Location,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
  readonly findById: (id: LocationId) => Effect.Effect<Location | null, InfrastructureError>;
  readonly findByExternalId: (
    clientId: ClientId,
    partitionId: PartitionId | null,
    externalId: string,
  ) => Effect.Effect<Location | null, InfrastructureError>;
  readonly listByMaster: (
    masterLocationId: MasterLocationId,
  ) => Effect.Effect<readonly Location[], InfrastructureError>;
  readonly listByClient: (
    query: ListByClientQuery,
  ) => Effect.Effect<ListByClientResult, InfrastructureError>;
}

export class Locations extends Context.Service<Locations, LocationsService>()(
  '@pinpoint/server/Locations',
) {
  static layer(port: LocationRepository): Layer.Layer<Locations> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `LOCATION_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(Locations, {
      persist: wrap('PERSIST', port.persist.bind(port)),
      delete: wrap('DELETE', port.delete.bind(port)),
      findById: wrap('READ', port.findById.bind(port)),
      findByExternalId: wrap('READ', port.findByExternalId.bind(port)),
      listByMaster: wrap('LIST', port.listByMaster.bind(port)),
      listByClient: wrap('LIST', port.listByClient.bind(port)),
    });
  }
}
