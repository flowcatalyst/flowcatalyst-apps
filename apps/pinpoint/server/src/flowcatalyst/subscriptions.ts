/**
 * Subscription definitions — one per business process (decider webhook),
 * each listening to multiple event types via `eventTypes[]`. Populated as
 * cross-aggregate process slices land.
 */
import { sync } from '@flowcatalyst/sdk';

export interface BuildPinpointSubscriptionsConfig {
  readonly publicBaseUrl: string;
  readonly dispatchPoolCode: string;
}

export function buildPinpointSubscriptions(
  _config: BuildPinpointSubscriptionsConfig,
): readonly sync.SubscriptionDefinition[] {
  return [];
}
