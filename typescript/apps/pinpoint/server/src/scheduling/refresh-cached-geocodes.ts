/**
 * Daily batch for cached third-party geocodes (Google Maps may be cached for
 * 30 days — see `domain/services/geocode-retention.ts`). Every master whose
 * cached geocode expires within the refresh margin is refreshed; one already
 * past expiry whose refresh fails has its coordinates deleted (inside
 * `refresh-master-location-geocode`).
 *
 * Same containment as `validate-master-locations.ts`: one `runWrite` per
 * master, sequential, failures collected in the summary.
 */
import { isFailure } from '@pinpoint/framework';
import type { AppContext } from '../app-context.js';
import { MasterLocationGeocodeExpired } from '../domain/locations/events/master-location-geocode-expired.event.js';
import { refreshCutoff } from '../domain/services/geocode-retention.js';

export interface RefreshCachedGeocodesBatchResult {
  readonly attempted: number;
  readonly refreshed: number;
  readonly expired: number;
  readonly failed: number;
  readonly failures: ReadonlyArray<{ readonly masterLocationId: string; readonly error: string }>;
}

export async function runRefreshCachedGeocodesBatch(
  appContext: AppContext,
  config: { readonly batchSize?: number; readonly now?: Date } = {},
): Promise<RefreshCachedGeocodesBatchResult> {
  const now = config.now ?? new Date();
  const masters = await appContext.repositories.masterLocations.listGeocodesExpiringBefore(
    refreshCutoff(now),
    config.batchSize ?? 500,
  );

  const failures: Array<{ masterLocationId: string; error: string }> = [];
  let refreshed = 0;
  let expired = 0;
  for (const master of masters) {
    try {
      const result = await appContext.runWrite(() =>
        appContext.useCases.refreshMasterLocationGeocode.execute({ masterLocationId: master.id }),
      );
      if (isFailure(result)) {
        failures.push({
          masterLocationId: master.id,
          error: `${result.error.type}:${result.error.code} ${result.error.message}`,
        });
      } else if (result.value instanceof MasterLocationGeocodeExpired) {
        expired += 1;
      } else {
        refreshed += 1;
      }
    } catch (err) {
      failures.push({
        masterLocationId: master.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { attempted: masters.length, refreshed, expired, failed: failures.length, failures };
}
