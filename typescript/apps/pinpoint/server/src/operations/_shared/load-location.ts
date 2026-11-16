/**
 * Shared guard for location use cases: the location exists and belongs to the
 * client named in the command.
 */
import { Result, UseCaseError } from '@pinpoint/framework';
import { asLocationId } from '../../domain/locations/ids.js';
import type { Location } from '../../domain/locations/location.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';

export type UseCaseFailure = Parameters<typeof Result.failure>[0];

export type Loaded =
  | { readonly ok: true; readonly location: Location }
  | { readonly ok: false; readonly error: UseCaseFailure };

export async function loadClientLocation(
  locations: LocationRepository,
  clientId: string,
  locationId: string,
): Promise<Loaded> {
  const id = asLocationId(locationId.trim());
  const location = await locations.findById(id);
  if (!location) {
    return { ok: false, error: UseCaseError.notFound('LOCATION_NOT_FOUND', `Location '${id}' not found.`) };
  }
  if (location.clientId !== clientId.trim()) {
    return {
      ok: false,
      error: UseCaseError.businessRule(
        'LOCATION_CLIENT_MISMATCH',
        'Location belongs to a different client.',
      ),
    };
  }
  return { ok: true, location };
}

/** Fire-and-forget trail write. */
export async function trail(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch {
    // swallow — the trail must never fail the use case
  }
}
