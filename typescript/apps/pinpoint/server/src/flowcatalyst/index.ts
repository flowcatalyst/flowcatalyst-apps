import type { sync } from '@flowcatalyst/sdk';
import { pinpointEventTypes } from './events.js';
import { buildPinpointSubscriptions } from './subscriptions.js';
import { buildPinpointDispatchPools } from './dispatch-pools.js';
import { pinpointRoles } from './roles.js';
import { buildPinpointScheduledJobs } from './scheduled-jobs.js';

export const PINPOINT_APPLICATION_CODE = 'pinpoint' as const;

export interface PinpointDefinitionsConfig {
  /** Public base URL the platform calls back into for webhooks. */
  readonly publicBaseUrl: string;
  /** Dispatch pool used by pinpoint-emitted dispatch jobs. */
  readonly dispatchPoolCode: string;
}

/**
 * Build the declarative set of FlowCatalyst definitions Pinpoint registers
 * via `pnpm flowcatalyst:sync`. Scheduled jobs ride along in the same
 * DefinitionSet (Slice 9) — the SDK's `client.definitions().sync(...)`
 * upserts them via `applications/{appCode}/scheduled-jobs/sync`, so we
 * don't need a separate runtime registration path.
 */
export function buildPinpointDefinitions(config: PinpointDefinitionsConfig): sync.DefinitionSet {
  return {
    applicationCode: PINPOINT_APPLICATION_CODE,
    eventTypes: [...pinpointEventTypes],
    subscriptions: [...buildPinpointSubscriptions(config)],
    dispatchPools: [...buildPinpointDispatchPools(config)],
    roles: [...pinpointRoles],
    scheduledJobs: [...buildPinpointScheduledJobs(config)],
  };
}
