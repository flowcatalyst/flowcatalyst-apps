/**
 * An operator supplies a location's coordinates + address components (often
 * a reverse-geocode suggestion, possibly edited): * → GEOCODED with source
 * OPERATOR — our own data, no expiry. The BFF then approves it, which also
 * makes it a master location.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Location } from '../../domain/locations/location.js';
import { LocationGeocodeConfirmed } from '../../domain/locations/events/location-geocode-confirmed.event.js';
import { addressDetailsFromLocation } from '../../domain/locations/events/address-details.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import { loadClientLocation, trail } from '../_shared/load-location.js';
import type { ConfirmLocationGeocodeCommand } from './confirm-location-geocode.command.js';

export class ConfirmLocationGeocodeUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationApprove;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
    private readonly processingLog: ProcessingLogRepository,
  ) {}

  async execute(command: ConfirmLocationGeocodeCommand): Promise<Result<LocationGeocodeConfirmed>> {
    const scope = ScopeStore.require();
    if (!scope.permissions.has(ConfirmLocationGeocodeUseCase.requiredPermission)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${ConfirmLocationGeocodeUseCase.requiredPermission}.`,
        ),
      );
    }
    const loaded = await loadClientLocation(this.locations, command.clientId, command.locationId);
    if (!loaded.ok) return Result.failure(loaded.error);
    const location = loaded.location;
    if (location.status === 'REJECTED') {
      return Result.failure(
        UseCaseError.businessRule('LOCATION_REJECTED', 'A rejected location cannot be geocoded.'),
      );
    }

    const now = new Date();
    const blank = (v: string | null | undefined) => (v && v.length > 0 ? v : null);
    const updated = Location.geocoded(
      location,
      {
        latitude: command.latitude,
        longitude: command.longitude,
        source: 'OPERATOR',
        confidence: 1,
        roadMatched: null,
        expiresAt: null,
        address: {
          houseNumber: blank(command.houseNumber),
          road: blank(command.road),
          suburb: blank(command.suburb),
          city: command.city,
          state: blank(command.state),
          postalCode: blank(command.postalCode),
          country: command.country,
        },
      },
      now,
    );
    const committed = await commitAggregate(
      this.uow,
      this.registry,
      updated,
      new LocationGeocodeConfirmed(scope, {
        locationId: location.id,
        clientId: location.clientId,
        latitude: command.latitude,
        longitude: command.longitude,
        address: addressDetailsFromLocation(updated),
      }),
      command,
    );
    await trail(() =>
      this.processingLog.append({ locationId: location.id }, ProcessingStep.ConfirmGeocode, {
        latitude: command.latitude,
        longitude: command.longitude,
        address: addressDetailsFromLocation(updated),
      }),
    );
    return committed;
  }
}
