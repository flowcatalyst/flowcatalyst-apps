// Scope
export { Scope, ScopeStore } from './scope/index.js';
export type {
  RequestToken,
  RequestScopeOptions,
  TaskIdentity,
  ParentEvent,
  TenantContext,
  MeasurementContext,
  CapturedQuery,
  SqlAuditContext,
} from './scope/index.js';

// Audit log
export type { AuditLog, CreateAuditLogData } from './audit/audit-log.js';

// Logging
export { createContextLogger } from './logging/logger.js';

// Jobs
export type { JobDescriptor } from './jobs/job-descriptor.js';
export { runJob } from './jobs/run-job.js';

// Drizzle measurement logger (scope-aware SQL capture)
export { ScopeAwareDrizzleLogger } from './measurements/drizzle-logger.js';

// Shared Drizzle column primitives + base entity types
export {
  baseEntityColumns,
  tsidColumn,
  rawTsidColumn,
  timestampColumn,
} from './schema/common.js';
export type { BaseEntity, NewEntity } from './schema/common.js';

// Local audit log table (used by commitAggregate's per-app audit row)
export { auditLogs } from './schema/audit-logs.js';
export type { NewAuditLog, AuditLogRow } from './schema/audit-logs.js';

// Transactions
export type { TransactionContext, TransactionManager } from './infrastructure/transaction.js';
export { createTransactionManager, resolveDb } from './infrastructure/transaction.js';
export { TransactionStore } from './infrastructure/transaction-store.js';

// Outbox driver (ALS-aware, ties outbox inserts to the active Drizzle tx)
export { DrizzleOutboxDriver } from './infrastructure/outbox-driver.js';

// Aggregate registry
export type {
  AggregateHandler,
  AggregateRegistry as AggregateRegistryImpl,
  TaggedAggregate,
} from './infrastructure/aggregate-registry.js';
export {
  createAggregateRegistry,
  createAggregateHandler,
  tagAggregate,
  isTaggedAggregate,
} from './infrastructure/aggregate-registry.js';

// Unit of Work + DispatchJobBroker Effect Tags and Layers
export {
  AggregateRegistry,
  DispatchJobBroker,
  buildOutboxManager,
  unitOfWorkLayer,
  dispatchJobBrokerLayer,
  aggregateRegistryLayer,
  commitAggregate,
  commitDelete,
} from './infrastructure/unit-of-work.js';
export type {
  OutboxManagerConfig,
  UnitOfWorkLayerOptions,
} from './infrastructure/unit-of-work.js';

// Non-Effect UoW path — same OutboxManager + DrizzleOutboxDriver + ALS tx
// store as the Effect path, just without the Effect wrapper. Apps that want
// plain async/await use cases consume these instead of the Tags + Layers.
// Names are `plain*` so the two surfaces can coexist during a migration.
export {
  createUnitOfWork as createPlainUnitOfWork,
  commitAggregate as plainCommitAggregate,
  commitDelete as plainCommitDelete,
  emitEvent as plainEmitEvent,
  toInfrastructureFailure,
} from './infrastructure/unit-of-work-plain.js';
export type { UnitOfWorkOptions as PlainUnitOfWorkOptions } from './infrastructure/unit-of-work-plain.js';
