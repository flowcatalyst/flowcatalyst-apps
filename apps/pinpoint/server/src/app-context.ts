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

/**
 * Composition root for the pinpoint server. Wires the (initially empty)
 * repository graph, the `UnitOfWork` / `DispatchJobBroker` / `AggregateRegistry`
 * Layers, and the `runWrite` boundary runner that opens a Drizzle tx, binds it
 * on ALS, and drains the Effect.
 *
 * One `OutboxManager` is built here and shared by both UoW and DispatchJobBroker
 * so events, audit logs, and dispatch jobs all ride the same `TransactionStore`-
 * bound Drizzle tx. As use-case slices land they get registered into the
 * `useCases` block and their repositories into `aggregateRegistry`.
 *
 * Keep this file dumb — wiring only, no business logic.
 */
export interface AppContext {
  readonly db: PostgresJsDatabase;
  readonly transactionManager: TransactionManager;
  readonly aggregateRegistry: AggregateRegistryImpl;
  readonly repositories: Record<string, never>;
  readonly useCases: Record<string, never>;
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

  // Empty prefix map until the first aggregate slice lands. Slice 2 (Clients
  // + Partitions) will populate this with their id prefixes.
  const aggregateRegistry = createAggregateRegistry({});

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
    repositories: {},
    useCases: {},
    runWrite,
  };
}
