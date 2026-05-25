/**
 * "Validate" a master location — geocode it. The Rust name is misleading:
 * this step turns PENDING into GEOCODED by resolving lat/lon via the
 * geocoder service. The semantic "validate" step (mark canonical +
 * cascade child locations) is `confirm-master-location`.
 *
 * Geocoder is a non-repo external service; surfaced via constructor along
 * with the UoW, registry, and master-location repo.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { MasterLocation } from '../../domain/locations/master-location.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { MasterLocationGeocoded } from '../../domain/locations/events/master-location-geocoded.event.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { GeocoderService } from '../../domain/services/geocoder.js';
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type { ValidateMasterLocationCommand } from './validate-master-location.command.js';

export class ValidateMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationValidate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masters: MasterLocationRepository,
    private readonly geocoder: GeocoderService,
  ) {}

  async execute(command: ValidateMasterLocationCommand): Promise<Result<MasterLocationGeocoded>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsMasterLocationValidate}.`,
        ),
      );
    }

    const masterId = asMasterLocationId(command.masterLocationId.trim());

    const master = await this.masters.findById(masterId);
    if (!master) {
      return Result.failure(
        UseCaseError.notFound(
          'MASTER_LOCATION_NOT_FOUND',
          `Master location '${masterId}' not found.`,
        ),
      );
    }
    if (master.status !== 'PENDING') {
      return Result.failure(
        UseCaseError.businessRule(
          'MASTER_LOCATION_NOT_PENDING',
          `Master location is in '${master.status}' status; expected PENDING.`,
        ),
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

    let geocode: Awaited<ReturnType<GeocoderService['geocode']>>;
    try {
      geocode = await this.geocoder.geocode(address);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return Result.failure(UseCaseError.infrastructure('GEOCODER_FAILED', message));
    }

    const updated = MasterLocation.geocoded(
      master,
      { latitude: geocode.latitude, longitude: geocode.longitude },
      new Date(),
    );

    const event = new MasterLocationGeocoded(scope, {
      masterLocationId: master.id,
      clientId: master.clientId,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      confidence: geocode.confidence,
      formattedAddress: geocode.formattedAddress,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(ValidateMasterLocationUseCase.requiredPermission);
  }
}
