/**
 * "Validate" a master location — geocode it. The Rust name is misleading:
 * this step turns PENDING into GEOCODED by resolving lat/lon via the
 * geocoder service. The semantic "validate" step (mark canonical +
 * cascade child locations) is `confirm-master-location`. Names preserved
 * for parity with the Rust pinpoint.
 *
 * Geocoder is a non-repo service (external HTTP), so it stays as a
 * constructor dep. Repo deps are yielded from the Effect environment.
 */
import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  type Scope,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { MasterLocation } from '../../domain/locations/master-location.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { MasterLocationGeocoded } from '../../domain/locations/events/master-location-geocoded.event.js';
import { MasterLocations } from '../../domain/locations/master-location.repository.js';
import type { GeocoderService } from '../../domain/services/geocoder.js';
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type { ValidateMasterLocationCommand } from './validate-master-location.command.js';

export class ValidateMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationValidate;

  constructor(private readonly geocoder: GeocoderService) {}

  execute = (
    command: ValidateMasterLocationCommand,
  ): Effect.Effect<
    Sealed<MasterLocationGeocoded>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | MasterLocations
  > => {
    const geocoder = this.geocoder;
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const masters = yield* MasterLocations;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LocationsMasterLocationValidate}.`,
          }),
        );
      }

      const masterId = asMasterLocationId(command.masterLocationId.trim());

      const master = yield* masters.findById(masterId);
      if (!master) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'MASTER_LOCATION_NOT_FOUND',
            message: `Master location '${masterId}' not found.`,
          }),
        );
      }
      if (master.status !== 'PENDING') {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'MASTER_LOCATION_NOT_PENDING',
            message: `Master location is in '${master.status}' status; expected PENDING.`,
          }),
        );
      }

      const address: NormalizedAddress = {
        houseNumber: master.normalizedHouseNumber,
        road: master.normalizedRoad,
        suburb: master.normalizedSuburb,
        city: master.normalizedCity,
        state: master.normalizedState,
        postalCode: master.normalizedPostalCode,
        country: master.normalizedCountry,
      };

      const result = yield* Effect.tryPromise({
        try: () => geocoder.geocode(address),
        catch: (cause) =>
          new InfrastructureError({
            code: 'GEOCODER_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const updated = MasterLocation.geocoded(
        master,
        { latitude: result.latitude, longitude: result.longitude },
        new Date(),
      );

      const event = new MasterLocationGeocoded(scope, {
        masterLocationId: master.id,
        clientId: master.clientId,
        latitude: result.latitude,
        longitude: result.longitude,
        confidence: result.confidence,
        formattedAddress: result.formattedAddress,
      });

      return yield* commitAggregate(updated, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
