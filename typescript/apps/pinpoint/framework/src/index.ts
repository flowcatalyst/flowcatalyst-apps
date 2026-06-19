/**
 * @pinpoint/framework — single-import surface for pinpoint server code.
 *
 * Bundles the non-Effect use-case primitives from `@flowcatalyst/sdk/usecase`
 * (sealed Result, UseCaseError, DomainEvent, etc.) together with the
 * `@flowcatalyst-apps/app-framework` primitives (Scope, ScopeStore,
 * TransactionStore, the plain UnitOfWork helpers). The Effect path from
 * app-framework is intentionally NOT re-exported here — Fulfil keeps using
 * it directly. Pinpoint's whole surface is plain async/await.
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

// Non-Effect UoW + commit helpers from app-framework. Re-exposed under their
// un-prefixed names since there's no Effect path left to clash with in
// pinpoint. Fulfil keeps importing the `plain*`-prefixed names directly.
export {
  createPlainUnitOfWork as createUnitOfWork,
  plainCommitAggregate as commitAggregate,
  plainCommitDelete as commitDelete,
  plainEmitEvent as emitEvent,
  toInfrastructureFailure,
} from '@flowcatalyst-apps/app-framework';
export type { PlainUnitOfWorkOptions as UnitOfWorkOptions } from '@flowcatalyst-apps/app-framework';

// App-framework primitives that aren't Effect-coupled — Scope / ScopeStore /
// TransactionStore / etc. Exposed here so route + use-case files import
// from a single `@pinpoint/framework` entry.
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
