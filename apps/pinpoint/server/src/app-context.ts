import { Effect, Layer, ManagedRuntime, Result } from 'effect';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AggregateRegistry,
  aggregateRegistryLayer,
  buildOutboxManager,
  createAggregateRegistry,
  createTransactionManager,
  DispatchJobBroker,
  dispatchJobBrokerLayer,
  TransactionStore,
  unitOfWorkLayer,
  type AggregateRegistryImpl,
  type Scope,
  type TransactionManager,
} from '@pinpoint/framework';
import type { UnitOfWork, UseCaseError } from '@pinpoint/framework';
import { createDrizzlePrincipalRepository } from './infrastructure/principal-repository.js';
import { createDrizzleCountryRepository } from './infrastructure/country-repository.js';
import { createDrizzleClientRepository } from './infrastructure/client-repository.js';
import { createDrizzlePartitionRepository } from './infrastructure/partition-repository.js';
import { createDrizzleLocationRepository } from './infrastructure/location-repository.js';
import { registerClient } from './infrastructure/register-client.js';
import { registerPartition } from './infrastructure/register-partition.js';
import { registerLocation } from './infrastructure/register-location.js';
import { CLIENT_ID_PREFIX, PARTITION_ID_PREFIX } from './domain/tenancy/ids.js';
import { CLIENT_TYPE } from './domain/tenancy/client.js';
import { PARTITION_TYPE } from './domain/tenancy/partition.js';
import { LOCATION_ID_PREFIX } from './domain/locations/ids.js';
import { LOCATION_TYPE } from './domain/locations/location.js';
import type { PrincipalRepository } from './domain/auth/principal.repository.js';
import type { CountryRepository } from './domain/reference/country.repository.js';
import type { ClientRepository } from './domain/tenancy/client.repository.js';
import type { PartitionRepository } from './domain/tenancy/partition.repository.js';
import type { LocationRepository } from './domain/locations/location.repository.js';
import { CreateClientUseCase } from './operations/create-client/create-client.use-case.js';
import { CreatePartitionUseCase } from './operations/create-partition/create-partition.use-case.js';
import { CreateLocationUseCase } from './operations/create-location/create-location.use-case.js';

/**
 * Composition root for the pinpoint server. Wires the repository graph, the
 * `UnitOfWork` / `DispatchJobBroker` / `AggregateRegistry` Layers, and the
 * `runWrite` boundary runner that opens a Drizzle tx, binds it on ALS, and
 * drains the Effect.
 *
 * One `OutboxManager` is built here and shared by both UoW and DispatchJobBroker
 * so events, audit logs, and dispatch jobs all ride the same `TransactionStore`-
 * bound Drizzle tx. As use-case slices land they get registered into the
 * `useCases` block and their repositories into `aggregateRegistry`.
 *
 * Keep this file dumb — wiring only, no business logic.
 */
export interface AppContextRepositories {
  readonly principals: PrincipalRepository;
  readonly countries: CountryRepository;
  readonly clients: ClientRepository;
  readonly partitions: PartitionRepository;
  readonly locations: LocationRepository;
}

export interface AppContextUseCases {
  readonly createClient: CreateClientUseCase;
  readonly createPartition: CreatePartitionUseCase;
  readonly createLocation: CreateLocationUseCase;
}

export interface AppContext {
  readonly db: PostgresJsDatabase;
  readonly transactionManager: TransactionManager;
  readonly aggregateRegistry: AggregateRegistryImpl;
  readonly repositories: AppContextRepositories;
  readonly useCases: AppContextUseCases;
  /**
   * Run a use-case Effect inside a Drizzle transaction. Provides
   * `UnitOfWork`, `DispatchJobBroker`, and `AggregateRegistry` Layers,
   * collapses the error channel via `Effect.result`, and returns the
   * resulting `Result<A, E>` as a Promise.
   *
   * Identity comes from `ScopeStore` (ALS); the program reads it directly
   * via `ScopeStore.require()` rather than through an Effect Tag.
   */
  readonly runWrite: <A>(
    program: Effect.Effect<A, UseCaseError, UnitOfWork | DispatchJobBroker | AggregateRegistry>,
    scope: Scope,
  ) => Promise<Result.Result<A, UseCaseError>>;
}

export interface AppContextConfig {
  readonly db: PostgresJsDatabase;
  /** FlowCatalyst client id — used by the outbox driver for message routing. */
  readonly clientId: string;
  /** Public base URL of this pinpoint instance — used by reactors to construct dispatch-job targets. */
  readonly publicBaseUrl: string;
  /** Dispatch-pool code used by pinpoint-emitted dispatch jobs. */
  readonly dispatchPoolCode: string;
}

export function createAppContext(config: AppContextConfig): AppContext {
  const { db, clientId } = config;

  const transactionManager = createTransactionManager(db);

  // Prefix-map lets plain-object aggregates resolve to the correct repository
  // handler at persist time. Principals carry an OIDC-shaped id (no TSID
  // prefix), so they don't register here.
  const aggregateRegistry = createAggregateRegistry({
    [CLIENT_ID_PREFIX]: CLIENT_TYPE,
    [PARTITION_ID_PREFIX]: PARTITION_TYPE,
    [LOCATION_ID_PREFIX]: LOCATION_TYPE,
  });

  const principalRepo = createDrizzlePrincipalRepository(db);
  const countryRepo = createDrizzleCountryRepository(db);
  const clientRepo = createDrizzleClientRepository(db);
  const partitionRepo = createDrizzlePartitionRepository(db);
  const locationRepo = createDrizzleLocationRepository(db);
  registerClient(aggregateRegistry, clientRepo);
  registerPartition(aggregateRegistry, partitionRepo);
  registerLocation(aggregateRegistry, locationRepo);

  // One OutboxManager backs both UoW and DispatchJobBroker.
  const outboxManager = buildOutboxManager({ clientId });

  const baseLayer = Layer.mergeAll(
    unitOfWorkLayer(outboxManager),
    dispatchJobBrokerLayer(outboxManager),
    aggregateRegistryLayer(aggregateRegistry),
  );
  const runtime = ManagedRuntime.make(baseLayer);

  const runWrite = async <A>(
    program: Effect.Effect<A, UseCaseError, UnitOfWork | DispatchJobBroker | AggregateRegistry>,
    _scope: Scope,
  ): Promise<Result.Result<A, UseCaseError>> => {
    const collected = Effect.result(program);
    return transactionManager.inTransaction((tx) =>
      TransactionStore.run(tx, () => runtime.runPromise(collected)),
    );
  };

  return {
    db,
    transactionManager,
    aggregateRegistry,
    repositories: {
      principals: principalRepo,
      countries: countryRepo,
      clients: clientRepo,
      partitions: partitionRepo,
      locations: locationRepo,
    },
    useCases: {
      createClient: new CreateClientUseCase(clientRepo),
      createPartition: new CreatePartitionUseCase(clientRepo, partitionRepo),
      createLocation: new CreateLocationUseCase(clientRepo, partitionRepo, locationRepo),
    },
    runWrite,
  };
}
