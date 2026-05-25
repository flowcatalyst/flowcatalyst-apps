/**
 * Non-Effect use-case surface for pinpoint. Mirrors the SDK's
 * `@flowcatalyst/sdk/usecase` plus the app-framework `plain*` UoW helpers.
 *
 * Use cases that have been migrated off Effect import from here; the rest
 * keep importing from `@pinpoint/framework`. When the migration finishes,
 * the Effect re-exports are deleted from the main entry and this module is
 * collapsed back into it.
 *
 * Re-exports `@flowcatalyst-apps/app-framework` at the bottom for ergonomic
 * one-stop access to ScopeStore / Scope / TransactionStore / etc.
 */

// Sealed Result + use-case primitives from the SDK's non-Effect surface.
export {
  Result,
  isSuccess,
  isFailure,
  UseCaseError,
  DomainEvent,
  BaseDomainEvent,
  ExecutionContext,
  SecuredUseCase,
  OutboxUnitOfWork,
  TxScopedOutboxUnitOfWork,
} from '@flowcatalyst/sdk/usecase';
export type {
  Success,
  Failure,
  UseCaseErrorBase,
  ValidationError,
  NotFoundError,
  BusinessRuleViolation,
  ConcurrencyError,
  AuthorizationError,
  InfrastructureError,
  DomainEventBase,
  Command,
  UseCase,
  Aggregate,
  UnitOfWork,
  OutboxUnitOfWorkConfig,
  OutboxUnitOfWorkOptions,
} from '@flowcatalyst/sdk/usecase';

// Non-Effect UoW + commit helpers from app-framework — un-prefixed in this
// module since there's no naming clash inside the plain surface.
export {
  createPlainUnitOfWork as createUnitOfWork,
  plainCommitAggregate as commitAggregate,
  plainCommitDelete as commitDelete,
  plainEmitEvent as emitEvent,
  toInfrastructureFailure,
} from '@flowcatalyst-apps/app-framework';
export type { PlainUnitOfWorkOptions as UnitOfWorkOptions } from '@flowcatalyst-apps/app-framework';

// App-framework primitives that aren't Effect-coupled — exposed here so the
// converted code doesn't need to import from two places.
export {
  Scope,
  ScopeStore,
  TransactionStore,
  createTransactionManager,
  resolveDb,
  DrizzleOutboxDriver,
  buildOutboxManager,
  createAggregateRegistry,
  createAggregateHandler,
  tagAggregate,
  isTaggedAggregate,
  baseEntityColumns,
  tsidColumn,
  rawTsidColumn,
  timestampColumn,
  auditLogs,
  createContextLogger,
  ScopeAwareDrizzleLogger,
  runJob,
} from '@flowcatalyst-apps/app-framework';
export type {
  RequestToken,
  RequestScopeOptions,
  TaskIdentity,
  ParentEvent,
  TenantContext,
  MeasurementContext,
  CapturedQuery,
  SqlAuditContext,
  TransactionContext,
  TransactionManager,
  AggregateHandler,
  AggregateRegistryImpl,
  TaggedAggregate,
  BaseEntity,
  NewEntity,
  NewAuditLog,
  AuditLogRow,
  AuditLog,
  CreateAuditLogData,
  JobDescriptor,
} from '@flowcatalyst-apps/app-framework';
