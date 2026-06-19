/**
 * FlowCatalyst-scheduled jobs for Pinpoint.
 *
 * Unlike roles / event types / subscriptions / dispatch pools, scheduled
 * jobs are NOT part of the declarative `sync.DefinitionSet` — they're
 * created and updated at runtime via `client.scheduledJobs()` (the SDK's
 * runtime resource API). The validation worker in Slice 9 lands the first
 * scheduled job and the script that registers it.
 *
 * Populated as scheduling slices land.
 */
import type { CreateScheduledJobRequest } from '@flowcatalyst/sdk';

export interface BuildPinpointScheduledJobsConfig {
  readonly publicBaseUrl: string;
  readonly dispatchPoolCode: string;
}

export function buildPinpointScheduledJobs(
  _config: BuildPinpointScheduledJobsConfig,
): readonly CreateScheduledJobRequest[] {
  return [];
}
