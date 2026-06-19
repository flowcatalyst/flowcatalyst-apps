// Scope, ScopeStore, RequestToken, contexts, JobDescriptor, runJob, AuditLog,
// createContextLogger, ScopeAwareDrizzleLogger are re-exported from the shared
// `@flowcatalyst-apps/app-framework` package — single source of truth across
// all apps in this monorepo.
export {
  Scope,
  ScopeStore,
  createContextLogger,
  runJob,
  ScopeAwareDrizzleLogger,
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
  AuditLog,
  CreateAuditLogData,
  JobDescriptor,
} from '@flowcatalyst-apps/app-framework';

// Use-case primitives — re-exported from @flowcatalyst/sdk's Effect surface.
// Single source of truth is the SDK; framework re-exports so consumers can keep
// importing from @fulfil/framework.
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

// Cache
export type { CacheStore, TaggedCacheStore, CacheManager } from './cache/index.js';
export { createCacheManager, createArrayStore, createRedisStore } from './cache/index.js';
export type { RedisStoreConfig, RedisClient } from './cache/index.js';

// Measurements
export type { RouteSlaDef, SlaTracker } from './measurements/sla-tracker.js';
export { createSlaTracker } from './measurements/sla-tracker.js';
export type { SlaSample, SlaSampleRepository } from './measurements/sla-sample.js';
export { metrics, getMetricsRegistry } from './measurements/prometheus.js';

// Notices
export type { Notice, CreateNotice, NoticeLevel } from './notices/notice.js';
export type { NoticeRepository } from './notices/notice-repository.js';
export type { NoticeService, NoticeServiceOptions } from './notices/notice-service.js';
export { createNoticeService } from './notices/notice-service.js';

// HTTP plugin
export { frameworkFastifyPlugin } from './http/fastify-plugin.js';
export type { FrameworkPluginOptions } from './http/fastify-plugin.js';
export type { RouteSlaOptions } from './http/route-sla.js';
