/**
 * System identities used when pinpoint runs work without a real user
 * principal — scheduled jobs, validation workers, dispatch-job retries.
 *
 * Identities are just `{ principalId }` records; `runJob(...)` from
 * `@pinpoint/framework` constructs a `Scope` around them with
 * `principalType: 'SERVICE'`. The principalId surfaces in scope-bound
 * logs and the local audit_logs / outbox rows the work emits.
 *
 * Mirrors fulfil's `SystemIdentity` shape so the two apps stay
 * comparable; refactoring this into `@flowcatalyst-apps/app-framework`
 * is on the deferred-cleanup list.
 */
import { ALL_PERMISSIONS_SET } from '../auth/role-permissions.js';

export const SystemIdentity = {
  /**
   * Used by the FlowCatalyst-scheduled validation worker (Slice 9).
   * Grants the full permission set — the scheduler is platform-driven
   * and pre-authorised; per-user permission checks don't apply.
   */
  SCHEDULER: {
    principalId: 'pinpoint:system:scheduler',
    permissions: ALL_PERMISSIONS_SET,
  },
} as const;
