/**
 * Daily batch for cached third-party geocodes (Google Maps may be cached for
 * 30 days — see `domain/services/geocode-retention.ts`). Every location whose
 * cached geocode expires within the refresh margin is refreshed; one already
 * past expiry whose refresh fails has its coordinates deleted (inside
 * `refresh-location-geocode`). Masters never hold third-party coordinates.
 *
 * Same containment as `approve-geocoded-locations.ts`: one `runWrite` per
 * location, sequential, failures collected in the summary.
 */
import { isFailure } from '@pinpoint/framework';
import type { AppContext } from '../app-context.js';
import { LocationGeocodeExpired } from '../domain/locations/events/location-geocode-expired.event.js';
import { refreshCutoff } from '../domain/services/geocode-retention.js';

export interface RefreshCachedGeocodesBatchResult {
  readonly attempted: number;
  readonly refreshed: number;
  readonly expired: number;
  readonly failed: number;
  readonly failures: ReadonlyArray<{ readonly locationId: string; readonly error: string }>;
}

export async function runRefreshCachedGeocodesBatch(
  appContext: AppContext,
  config: { readonly batchSize?: number; readonly now?: Date } = {},
): Promise<RefreshCachedGeocodesBatchResult> {
  const now = config.now ?? new Date();
  const locations = await appContext.repositories.locations.listGeocodesExpiringBefore(
    refreshCutoff(now),
    config.batchSize ?? 500,
  );

  const failures: Array<{ locationId: string; error: string }> = [];
  let refreshed = 0;
  let expired = 0;
  for (const location of locations) {
    try {
      const result = await appContext.runWrite(() =>
        appContext.useCases.refreshLocationGeocode.execute({ locationId: location.id }),
      );
      if (isFailure(result)) {
        failures.push({
          locationId: location.id,
          error: `${result.error.type}:${result.error.code} ${result.error.message}`,
        });
      } else if (result.value instanceof LocationGeocodeExpired) {
        expired += 1;
      } else {
        refreshed += 1;
      }
    } catch (err) {
      failures.push({
        locationId: location.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { attempted: locations.length, refreshed, expired, failed: failures.length, failures };
}
