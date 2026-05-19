// @pinpoint/framework re-exports @flowcatalyst-apps/app-framework so server
// code can keep importing from a single "framework" alias even when we later
// add pinpoint-specific extras (cache, notice, etc.) alongside the shared
// primitives. Mirrors @fulfil/framework's pattern.
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
