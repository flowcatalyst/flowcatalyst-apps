/**
 * Two views of the same repo, used at different boundaries:
 *
 *  - `ClientRepository` (interface) is the Promise-typed contract the
 *    Drizzle impl actually implements + the shape the
 *    `AggregateRegistry` calls into (its `persist`/`delete` callback
 *    chain is plain async, not Effect-typed — the SDK's
 *    `UnitOfWork.commit(persist)` is `() => Promise<void>`).
 *
 *  - `Clients` is the Effect `Context.Tag` — what use cases yield.
 *    Methods return `Effect<T, InfrastructureError>` pre-wrapped, so
 *    call sites skip the per-call `Effect.tryPromise` boilerplate.
 *
 *  - `Clients.layer(port)` builds the Layer that adapts the Promise
 *    repo into the Effect-shaped Tag. One adapter site, every use case
 *    that yields the Tag benefits.
 *
 * The split is forced by the SDK's UoW shape — registry-facing code
 * needs Promise, Effect-facing code wants Effect. Bridging at the
 * boundary (rather than each use case) is the right place.
 *
 * The original `ClientRepository` Promise interface is preserved so
 * use cases that haven't been migrated to the Tag yet keep working
 * without churn. Convert one use case at a time.
 */
import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
import type { Client } from './client.js';
import type { ClientId } from './ids.js';

export interface ListClientsQuery {
  readonly limit: number;
  readonly offset: number;
}

export interface ListClientsResult {
  readonly clients: readonly Client[];
  readonly total: number;
}

export interface ClientRepository {
  persist(aggregate: Client, tx?: TransactionContext): Promise<Client>;
  delete(aggregate: Client, tx?: TransactionContext): Promise<boolean>;

  findById(id: ClientId): Promise<Client | null>;
  findByCode(code: string): Promise<Client | null>;
  listAll(query: ListClientsQuery): Promise<ListClientsResult>;

  /** Total client count. Used by the BFF dashboard. */
  count(): Promise<number>;
}

export interface ClientsService {
  readonly persist: (
    aggregate: Client,
    tx?: TransactionContext,
  ) => Effect.Effect<Client, InfrastructureError>;
  readonly delete: (
    aggregate: Client,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
  readonly findById: (id: ClientId) => Effect.Effect<Client | null, InfrastructureError>;
  readonly findByCode: (code: string) => Effect.Effect<Client | null, InfrastructureError>;
  readonly listAll: (
    query: ListClientsQuery,
  ) => Effect.Effect<ListClientsResult, InfrastructureError>;
  readonly count: () => Effect.Effect<number, InfrastructureError>;
}

export class Clients extends Context.Service<Clients, ClientsService>()(
  '@pinpoint/server/Clients',
) {
  /**
   * Adapt the Promise-typed `ClientRepository` into the Effect-shaped
   * `Clients` Tag. Each method wraps the underlying Promise in
   * `Effect.tryPromise` with a typed `InfrastructureError` once, here
   * at the boundary — every use case call site collapses from a five-
   * line `Effect.tryPromise({ try, catch })` to a one-line
   * `yield* clients.findById(id)`.
   */
  static layer(port: ClientRepository): Layer.Layer<Clients> {
    const wrap =
      <Args extends readonly unknown[], A>(
        op: string,
        fn: (...args: Args) => Promise<A>,
      ) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `CLIENT_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(Clients, {
      persist: wrap('PERSIST', port.persist.bind(port)),
      delete: wrap('DELETE', port.delete.bind(port)),
      findById: wrap('READ', port.findById.bind(port)),
      findByCode: wrap('READ', port.findByCode.bind(port)),
      listAll: wrap('LIST', port.listAll.bind(port)),
      count: wrap('COUNT', port.count.bind(port)),
    });
  }
}
