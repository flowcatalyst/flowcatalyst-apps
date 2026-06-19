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
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
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
