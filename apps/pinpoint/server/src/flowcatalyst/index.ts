import { sync } from '@flowcatalyst/sdk';
import { pinpointEventTypes } from './events.js';
import { buildPinpointSubscriptions } from './subscriptions.js';
import { buildPinpointDispatchPools } from './dispatch-pools.js';
import { pinpointRoles } from './roles.js';

export const PINPOINT_APPLICATION_CODE = 'pinpoint' as const;

export interface PinpointDefinitionsConfig {
  /** Public base URL the platform calls back into for webhooks. */
  readonly publicBaseUrl: string;
  /** Dispatch pool used by pinpoint-emitted dispatch jobs. */
  readonly dispatchPoolCode: string;
}

/**
 * Build the declarative set of FlowCatalyst definitions Pinpoint registers
 * via `pnpm flowcatalyst:sync`. Scheduled jobs are registered separately
 * via the runtime resource API — see `./scheduled-jobs.ts`.
 */
export function buildPinpointDefinitions(config: PinpointDefinitionsConfig): sync.DefinitionSet {
  return {
    applicationCode: PINPOINT_APPLICATION_CODE,
    eventTypes: [...pinpointEventTypes],
    subscriptions: [...buildPinpointSubscriptions(config)],
    dispatchPools: [...buildPinpointDispatchPools(config)],
    roles: [...pinpointRoles],
  };
}
