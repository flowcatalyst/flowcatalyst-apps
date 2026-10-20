/**
 * FlowCatalyst-scheduled jobs for Pinpoint.
 *
 * Scheduled jobs ride along in the declarative `sync.DefinitionSet`
 * (`scheduledJobs`) and are upserted by `pnpm flowcatalyst:sync`. The
 * platform fires each job by POSTing to `targetUrl` with an HMAC signature
 * (`FLOWCATALYST_SIGNING_SECRET` on our side), and the matching route under
 * `api/routes/jobs/` runs the work inside `runJob(...)` with the
 * `SystemIdentity.SCHEDULER` scope.
 */
import type { sync } from '@flowcatalyst/sdk';

export interface BuildPinpointScheduledJobsConfig {
  /** Public base URL of this pinpoint deployment (no trailing slash). */
  readonly publicBaseUrl: string;
  readonly dispatchPoolCode: string;
}

export const VALIDATE_MASTER_LOCATIONS_JOB_CODE = 'pinpoint-validate-master-locations' as const;
export const VALIDATE_MASTER_LOCATIONS_JOB_PATH = '/jobs/validate-master-locations' as const;
export const PRUNE_REQUEST_LOGS_JOB_CODE = 'pinpoint-prune-request-logs' as const;
export const PRUNE_REQUEST_LOGS_JOB_PATH = '/jobs/prune-request-logs' as const;
export const REFRESH_CACHED_GEOCODES_JOB_CODE = 'pinpoint-refresh-cached-geocodes' as const;
export const REFRESH_CACHED_GEOCODES_JOB_PATH = '/jobs/refresh-cached-geocodes' as const;

export function buildPinpointScheduledJobs(
  config: BuildPinpointScheduledJobsConfig,
): readonly sync.ScheduledJobDefinition[] {
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  return [
    {
      code: VALIDATE_MASTER_LOCATIONS_JOB_CODE,
      name: 'Validate master locations',
      description:
        'Every 5 minutes: drain the GEOCODED master-location backlog (100 per firing) and ' +
        'run confirm-master-location on each (canonicalise + cascade LocationValidated).',
      crons: ['*/5 * * * *'],
      timezone: 'UTC',
      // One firing at a time across replicas — the batch is sequential by design
      // (see scheduling/validate-master-locations.ts).
      concurrent: false,
      // The webhook replies synchronously with the batch summary; there is no
      // separate completion callback.
      tracksCompletion: false,
      timeoutSeconds: 300,
      deliveryMaxAttempts: 1,
      targetUrl: `${base}${VALIDATE_MASTER_LOCATIONS_JOB_PATH}`,
    },
    {
      code: PRUNE_REQUEST_LOGS_JOB_CODE,
      name: 'Prune request logs',
      description:
        'Daily at 02:30 UTC: delete request_logs rows older than ' +
        'PINPOINT_REQUEST_LOG_RETENTION_DAYS (default 400).',
      crons: ['30 2 * * *'],
      timezone: 'UTC',
      concurrent: false,
      tracksCompletion: false,
      timeoutSeconds: 300,
      deliveryMaxAttempts: 1,
      targetUrl: `${base}${PRUNE_REQUEST_LOGS_JOB_PATH}`,
    },
    {
      code: REFRESH_CACHED_GEOCODES_JOB_CODE,
      name: 'Refresh cached geocodes',
      description:
        'Daily at 03:00 UTC: renew master locations\' cached Google Maps geocodes before their ' +
        '30 days (Google\'s caching limit) run out; delete any that expired without a renewal.',
      crons: ['0 3 * * *'],
      timezone: 'UTC',
      concurrent: false,
      tracksCompletion: false,
      timeoutSeconds: 600,
      deliveryMaxAttempts: 1,
      targetUrl: `${base}${REFRESH_CACHED_GEOCODES_JOB_PATH}`,
    },
  ];
}
