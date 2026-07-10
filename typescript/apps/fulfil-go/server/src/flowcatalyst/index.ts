import type { sync } from '@flowcatalyst/sdk';
import { fulfilGoEventTypes } from './events.js';
import { fulfilGoRoles } from './roles.js';

export const FULFILGO_APPLICATION_CODE = 'fulfil-go' as const;

export interface FulfilGoDefinitionsConfig {
  /** Public base URL the platform calls back into for webhooks. */
  readonly publicBaseUrl: string;
  /** Dispatch pool used by fulfil-go-emitted dispatch jobs. */
  readonly dispatchPoolCode: string;
}

/**
 * Declarative FlowCatalyst definitions fulfil-go registers via
 * `pnpm flowcatalyst:sync`. Subscriptions (the process manager's inbound
 * events) and the `release-picks` scheduled job land with their features.
 */
export function buildFulfilGoDefinitions(config: FulfilGoDefinitionsConfig): sync.DefinitionSet {
  return {
    applicationCode: FULFILGO_APPLICATION_CODE,
    // Strip payloadSchema: the definitions endpoint validates strictly and
    // rejects it — schemas are pushed separately via addSchemaVersion
    // (phase 2 of the sync script).
    eventTypes: fulfilGoEventTypes.map(({ payloadSchema: _schema, ...definition }) => definition),
    subscriptions: [
      {
        code: 'fulfil-go-fulfilment-process',
        name: 'Fulfilment Process',
        description:
          'The fulfilment process manager: subscribes to pick-context outcomes ' +
          'and advances part + fulfilment state (picking → picked/short_picked ' +
          '→ ready, or the all-or-nothing failure fan-out).',
        target: `${config.publicBaseUrl}/processes/fulfilment`,
        eventTypes: [
          { eventTypeCode: 'fulfil-go:pick:pick:claimed' },
          { eventTypeCode: 'fulfil-go:pick:pick:picked' },
          { eventTypeCode: 'fulfil-go:pick:pick:short-picked' },
          { eventTypeCode: 'fulfil-go:pick:pick:failed' },
        ],
        dispatchPoolCode: config.dispatchPoolCode,
        mode: 'BLOCK_ON_ERROR',
        maxRetries: 5,
        timeoutSeconds: 30,
        dataOnly: true,
      },
    ],
    dispatchPools: [
      {
        code: config.dispatchPoolCode,
        name: 'FulfilGo default dispatch pool',
      },
    ],
    roles: [...fulfilGoRoles],
    scheduledJobs: [
      {
        code: 'fulfil-go-release-picks',
        name: 'Release picks',
        description:
          'Pick-release sweep: finds pending fulfilment parts whose releaseAt ' +
          'has passed and dispatches create-pick to the pick context.',
        // 6-field, SECONDS-FIRST (platform cron parser): fires at second 0 of
        // every minute. NB a 5-field cron passes the platform's shape check
        // and shows ACTIVE but NEVER fires — bit us 2026-07-10.
        crons: ['0 * * * * *'],
        timezone: 'UTC',
        concurrent: false,
        tracksCompletion: false,
        timeoutSeconds: 60,
        targetUrl: `${config.publicBaseUrl}/jobs/release-picks`,
      },
    ],
  };
}
