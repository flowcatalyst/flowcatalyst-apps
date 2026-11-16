/**
 * Auto-approval batch. Every 5 minutes (`pinpoint-approve-geocoded-locations`)
 * the platform fires this; it drains GEOCODED locations and approves the ones
 * whose geocode is good enough to trust without a person:
 *
 *   - on the requested road (`geocodeRoadMatched !== false`),
 *   - at the house when the address names one (a house number resolved),
 *   - confidence ≥ the client / partition's `autoApproveThreshold` (0.9).
 *
 * The rest stay GEOCODED in the review queue. Approval of a Photon geocode
 * also creates a master location (`approve-location`).
 *
 * Per-location containment: each approval is its own `runWrite`; one failure
 * doesn't abort the batch. Sequential, like the old master batch.
 */
import { isFailure } from '@pinpoint/framework';
import type { AppContext } from '../app-context.js';
import type { Location } from '../domain/locations/location.js';
import type { MatchingConfig } from '../domain/matching/matching-config.js';
import { lineWantsHouse } from '../domain/services/house-number.js';

export interface ApproveGeocodedLocationsBatchResult {
  readonly attempted: number;
  readonly approved: number;
  /** Left for review: not on the road, not at the house, or not confident enough. */
  readonly heldForReview: number;
  readonly failed: number;
  readonly failures: ReadonlyArray<{ readonly locationId: string; readonly error: string }>;
}

/** Whether a GEOCODED location may be approved without a person. */
export function isAutoApprovable(
  location: Location,
  config: Pick<MatchingConfig, 'autoApproveThreshold'>,
): boolean {
  if (location.status !== 'GEOCODED' || location.latitude === null) return false;
  if (location.geocodeRoadMatched === false) return false;
  if (lineWantsHouse(location.matchAddress) && !location.normalizedHouseNumber?.trim()) return false;
  return (location.geocodeConfidence ?? 0) >= config.autoApproveThreshold;
}

export async function runApproveGeocodedLocationsBatch(
  appContext: AppContext,
  config: { readonly batchSize?: number } = {},
): Promise<ApproveGeocodedLocationsBatchResult> {
  const locations = await appContext.repositories.locations.listByStatus(
    'GEOCODED',
    config.batchSize ?? 200,
  );

  const failures: Array<{ locationId: string; error: string }> = [];
  let approved = 0;
  let heldForReview = 0;
  const configs = new Map<string, MatchingConfig>();

  for (const location of locations) {
    try {
      const key = `${location.clientId}/${location.partitionId ?? ''}`;
      let matching = configs.get(key);
      if (!matching) {
        matching = await appContext.repositories.matchingConfigs.resolve(
          location.clientId,
          location.partitionId,
        );
        configs.set(key, matching);
      }
      if (!isAutoApprovable(location, matching)) {
        heldForReview += 1;
        continue;
      }
      const result = await appContext.runWrite(() =>
        appContext.useCases.approveLocation.execute({
          clientId: location.clientId,
          locationId: location.id,
        }),
      );
      if (isFailure(result)) {
        failures.push({
          locationId: location.id,
          error: `${result.error.type}:${result.error.code} ${result.error.message}`,
        });
        continue;
      }
      approved += 1;
    } catch (err) {
      failures.push({
        locationId: location.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { attempted: locations.length, approved, heldForReview, failed: failures.length, failures };
}
