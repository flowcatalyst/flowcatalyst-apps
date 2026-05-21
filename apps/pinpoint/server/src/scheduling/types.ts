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
export const SystemIdentity = {
  /** Used by the FlowCatalyst-scheduled validation worker (Slice 9). */
  SCHEDULER: { principalId: 'pinpoint:system:scheduler' },
} as const;
