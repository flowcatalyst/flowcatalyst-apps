// @pinpoint/framework re-exports @flowcatalyst-apps/app-framework so server
// code can keep importing from a single "framework" alias even when we later
// add pinpoint-specific extras (cache, notice, etc.) alongside the shared
// primitives. Mirrors @fulfil/framework's pattern.
//
// MIGRATION NOTE: pinpoint is moving off Effect to plain async/await + the
// SDK's non-Effect use-case surface. While the sweep is in flight, both
// surfaces ship side-by-side:
//   - this file (`@pinpoint/framework`) keeps re-exporting the Effect surface
//     so un-converted use cases / repos / routes / tests keep compiling
//   - `@pinpoint/framework/plain` exposes the non-Effect surface for newly
//     converted code (sealed Result, plain UoW, plainCommitAggregate, etc.)
// When the sweep finishes, the Effect re-exports here get deleted and the
// `/plain` subpath is collapsed back into the main entry.
export * from '@flowcatalyst-apps/app-framework';

// Use-case primitives — single source of truth is the SDK; re-exported here
// for consumer ergonomics.
export {
  UnitOfWork,
  ExecutionContext,
  ValidationError,
  NotFoundError,
  BusinessRuleViolation,
  ConcurrencyError,
  AuthorizationError,
  InfrastructureError,
  httpStatus,
  DomainEvent,
  BaseDomainEvent,
  OutboxUnitOfWork,
  TestUnitOfWork,
} from '@flowcatalyst/sdk/effect/usecase';
export type {
  Sealed,
  UseCaseError,
  Command,
  UseCase,
  Aggregate,
  DomainEventBase,
} from '@flowcatalyst/sdk/effect/usecase';
