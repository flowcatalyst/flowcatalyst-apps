import type { TenantContext } from '../scope/contexts/tenant-context.js';

export interface JobDescriptor {
  readonly name: string;
  readonly identity: {
    readonly principalId: string;
    /**
     * Optional permission set to grant for the job's scope. Used by
     * scheduled jobs / process webhooks that need a fixed set of
     * permissions (e.g. the validation worker granting itself
     * `MASTER_LOCATION_CONFIRM`). Omitted = empty permission set.
     */
    readonly permissions?: ReadonlySet<string>;
  };
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly tenant?: TenantContext;
  readonly sqlSampling?: boolean;
}
