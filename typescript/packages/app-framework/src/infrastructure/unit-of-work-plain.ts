/**
 * Non-Effect Unit of Work surface, parallel to `unit-of-work.ts`.
 *
 * Shares the same `OutboxManager` / `DrizzleOutboxDriver` / `TransactionStore`
 * stack as the Effect path — only the wrapper changes. Apps that don't want
 * Effect can build their UoW with `createUnitOfWork(manager, registry, ...)`
 * and call the plain `commitAggregate(...)` / `commitDelete(...)` helpers from
 * their use cases.
 *
 * The Effect path in `unit-of-work.ts` keeps working unchanged so Fulfil (and
 * any other Effect-based consumer) is unaffected.
 */

import { generateTsid, type OutboxManager } from '@flowcatalyst/sdk';
import {
  DomainEvent as DomainEventNS,
  OutboxUnitOfWork,
  Result,
  UseCaseError,
  type Aggregate,
  type DomainEvent,
  type UnitOfWork,
} from '@flowcatalyst/sdk/usecase';
import type { AggregateRegistry } from './aggregate-registry.js';
import { TransactionStore } from './transaction-store.js';
import { auditLogs, type NewAuditLog } from '../schema/audit-logs.js';
import type { TransactionContext } from './transaction.js';

export interface UnitOfWorkOptions {
  /** Emit a SDK audit log per commit. Default: true (parity with Effect path). */
  readonly auditEnabled?: boolean;
}

/**
 * Build a non-Effect UnitOfWork over the shared `OutboxManager`. The returned
 * value is the SDK's `OutboxUnitOfWork` class — `commit` / `commitAggregate`
 * / `commitDelete` / `emitEvent` return `Promise<Result<E>>`. Persistence
 * happens through the `persist` callback the SDK passes through; in pinpoint
 * we orchestrate that via {@link commitAggregate} below.
 */
export function createUnitOfWork(manager: OutboxManager, options?: UnitOfWorkOptions): UnitOfWork {
  return new OutboxUnitOfWork({
    outboxManager: manager,
    options: { auditEnabled: options?.auditEnabled ?? true },
  });
}

/**
 * Commit an aggregate change + emit the domain event atomically.
 *
 * Mirrors the Effect-path `commitAggregate` from `unit-of-work.ts`:
 *  1. `registry.persist(aggregate, tx)` — write the aggregate row
 *  2. `writeLocalAuditLog(tx, event, command)` — append the local audit row
 *  3. SDK's `OutboxUnitOfWork.commitAggregate` writes the outbox event + audit
 *
 * All four writes ride the same Drizzle tx because the persist callback reads
 * `tx` from `TransactionStore` and the `DrizzleOutboxDriver` does the same.
 */
export async function commitAggregate<E extends DomainEvent>(
  uow: UnitOfWork,
  registry: AggregateRegistry,
  aggregate: Aggregate,
  event: E,
  command: unknown,
): Promise<Result<E>> {
  return uow.commitAggregate(aggregate, event, command, async () => {
    const tx = TransactionStore.require();
    await registry.persist(aggregate as never, tx);
    await writeLocalAuditLog(tx, event, command);
  });
}

/** Commit a deletion — same semantics as {@link commitAggregate}, signals intent. */
export async function commitDelete<E extends DomainEvent>(
  uow: UnitOfWork,
  registry: AggregateRegistry,
  aggregate: Aggregate,
  event: E,
  command: unknown,
): Promise<Result<E>> {
  return uow.commitDelete(aggregate, event, command, async () => {
    const tx = TransactionStore.require();
    await registry.delete(aggregate as never, tx);
    await writeLocalAuditLog(tx, event, command);
  });
}

/**
 * Emit a domain event with no entity change (e.g. `UserLoggedIn`). Useful for
 * use cases that signal a fact without mutating an aggregate. The event still
 * rides the same tx via the ALS-bound `DrizzleOutboxDriver`.
 */
export async function emitEvent<E extends DomainEvent>(
  uow: UnitOfWork,
  event: E,
  command: unknown,
): Promise<Result<E>> {
  return uow.emitEvent(event, command);
}

/**
 * Map an arbitrary thrown error to a `Result.failure(infrastructure)` — handy
 * inside a `runWrite` boundary that needs to convert raw Drizzle / network
 * failures into a typed `Result` without leaking the exception.
 */
export function toInfrastructureFailure<T>(
  err: unknown,
  code = 'INFRASTRUCTURE_FAILURE',
): Result<T> {
  const message = err instanceof Error ? err.message : String(err);
  return Result.failure(UseCaseError.infrastructure(code, message, { cause: message }));
}

async function writeLocalAuditLog(
  tx: TransactionContext,
  event: DomainEvent,
  command: unknown,
): Promise<void> {
  const entityType = DomainEventNS.extractAggregateType(event.subject);
  const entityId = DomainEventNS.extractEntityId(event.subject);

  const row: NewAuditLog = {
    id: generateTsid(),
    entityType,
    entityId: entityId ?? 'unknown',
    operation: event.eventType,
    operationJson:
      command !== null && command !== undefined ? JSON.parse(JSON.stringify(command)) : null,
    principalId: event.principalId,
    performedAt: event.time,
  };

  await tx.db.insert(auditLogs).values(row);
}
