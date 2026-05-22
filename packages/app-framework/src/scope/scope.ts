import { generateTsid } from '@flowcatalyst/sdk';
import type { TenantContext } from './contexts/tenant-context.js';
import {
  type MeasurementContext,
  createMeasurementContext,
} from './contexts/measurement-context.js';
import {
  type SqlAuditContext,
  SqlAuditContext as SqlAuditContextFactory,
} from './contexts/sql-audit-context.js';

const PRINCIPAL_TYPES = {
  USER: 'USER',
  SERVICE: 'SERVICE',
} as const;

type PrincipalType = (typeof PRINCIPAL_TYPES)[keyof typeof PRINCIPAL_TYPES];

export interface Scope {
  readonly executionId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly principalId: string;
  readonly principalType: PrincipalType;
  readonly initiatedAt: Date;

  readonly tenant: TenantContext | null;
  readonly measurement: MeasurementContext;
  readonly sqlAudit: SqlAuditContext;

  /**
   * Permissions granted to this scope, expanded from token claims at
   * scope-creation time. Use cases check membership via `scope.permissions.has(...)`
   * against their `static readonly requiredPermission`. Empty set means
   * "no permissions granted" — every authorize() check will fail.
   *
   * The set is shared by reference, so callers MUST NOT mutate it. The
   * type is `ReadonlySet<string>` to make that compile-checked.
   */
  readonly permissions: ReadonlySet<string>;
}

export interface RequestToken {
  readonly sub: string;
  readonly correlationId?: string | undefined;
  readonly causationId?: string | null;
  /**
   * Optional pre-expanded permission set. Apps populate this in their
   * `extractRequestToken` from token claims (e.g. mapping `roles` →
   * permissions via a per-app catalog). Omitted = no permissions
   * granted.
   */
  readonly permissions?: ReadonlySet<string> | undefined;
}

export interface RequestScopeOptions {
  readonly tenant?: TenantContext;
  readonly captureSql?: boolean;
}

export interface TaskIdentity {
  readonly principalId: string;
  /**
   * Optional permission set to grant for the duration of the task /
   * webhook scope. Used by scheduled jobs and process webhooks that
   * need a fixed set of permissions (e.g. the validation worker
   * granting itself MASTER_LOCATION_CONFIRM). Omitted = no permissions.
   */
  readonly permissions?: ReadonlySet<string> | undefined;
}

export interface ParentEvent {
  readonly correlationId: string;
  readonly eventId: string;
}

function fromRequest(token: RequestToken, options: RequestScopeOptions = {}): Scope {
  return {
    executionId: generateTsid(),
    correlationId: token.correlationId ?? generateTsid(),
    causationId: token.causationId ?? null,
    principalId: token.sub,
    principalType: PRINCIPAL_TYPES.USER,
    initiatedAt: new Date(),
    tenant: options.tenant ?? null,
    measurement: createMeasurementContext(),
    sqlAudit: options.captureSql
      ? SqlAuditContextFactory.capturing()
      : SqlAuditContextFactory.inactive(),
    permissions: token.permissions ?? EMPTY_PERMISSIONS,
  };
}

function forScheduledTask(identity: TaskIdentity): Scope {
  return {
    executionId: generateTsid(),
    correlationId: generateTsid(),
    causationId: null,
    principalId: identity.principalId,
    principalType: PRINCIPAL_TYPES.SERVICE,
    initiatedAt: new Date(),
    tenant: null,
    measurement: createMeasurementContext(),
    sqlAudit: SqlAuditContextFactory.inactive(),
    // Scheduled tasks run as the SCHEDULER service identity — they're
    // platform-emitted, never user-driven, so they bypass permission
    // checks. Use cases that the scheduler invokes either run with the
    // full permission set or skip authorize() entirely (compare with
    // Rust's `SystemIdentity::SCHEDULER`).
    permissions: identity.permissions ?? EMPTY_PERMISSIONS,
  };
}

function fromParentEvent(parentEvent: ParentEvent, identity: TaskIdentity): Scope {
  return {
    executionId: generateTsid(),
    correlationId: parentEvent.correlationId,
    causationId: parentEvent.eventId,
    principalId: identity.principalId,
    principalType: PRINCIPAL_TYPES.SERVICE,
    initiatedAt: new Date(),
    tenant: null,
    measurement: createMeasurementContext(),
    sqlAudit: SqlAuditContextFactory.inactive(),
    permissions: identity.permissions ?? EMPTY_PERMISSIONS,
  };
}

const EMPTY_PERMISSIONS: ReadonlySet<string> = new Set();

export const Scope = {
  fromRequest,
  forScheduledTask,
  fromParentEvent,
} as const;
