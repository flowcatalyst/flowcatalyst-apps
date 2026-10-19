/**
 * "Validate" a master location — geocode it. The Rust name is misleading:
 * this step turns PENDING into GEOCODED by resolving lat/lon via the
 * geocoder service. The semantic "validate" step (mark canonical +
 * cascade child locations) is `confirm-master-location`.
 *
 * A master created from a raw line has no components yet (city UNRESOLVED):
 * it is geocoded from its address line as free text, and the components the
 * geocoder resolved are stored on it. Its address line and hash stay as they
 * were — they are the matching key for future identical lines. A master whose
 * components an operator set is geocoded from those components.
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
import { addressDetailsFromMaster } from '../../domain/locations/events/address-details.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { GeocoderService } from '../../domain/services/geocoder.js';
import {
  isUnresolved,
  UNRESOLVED_COMPONENT,
  type NormalizedAddress,
} from '../../domain/services/address-normalizer.js';
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

    const unparsed = isUnresolved(master.normalizedCity) && master.normalizedAddressLine !== null;
    const now = new Date();

    let geocode: Awaited<ReturnType<GeocoderService['geocode']>>;
    try {
      if (unparsed) {
        geocode = await this.geocoder.geocodeText(master.normalizedAddressLine!, {
          countryCode: isUnresolved(master.normalizedCountry) ? null : master.normalizedCountry,
        });
      } else {
        const address: NormalizedAddress = addressDetailsFromMaster(master);
        geocode = await this.geocoder.geocode(address);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return Result.failure(UseCaseError.infrastructure('GEOCODER_FAILED', message));
    }

    // A best guess on some other road (roadMatched false) gets coordinates but
    // not that road's components — an operator fixes it from the review queue.
    const resolved =
      unparsed && geocode.roadMatched !== false
        ? withResolvedComponents(master, geocode.address, now)
        : master;
    const updated = MasterLocation.geocoded(
      resolved,
      { latitude: geocode.latitude, longitude: geocode.longitude },
      now,
    );

    const event = new MasterLocationGeocoded(scope, {
      masterLocationId: master.id,
      clientId: master.clientId,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      confidence: geocode.confidence,
      formattedAddress: geocode.formattedAddress,
      address: geocode.address,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(ValidateMasterLocationUseCase.requiredPermission);
  }
}

/**
 * Store the components the geocoder resolved, keeping the master's address
 * line + hash. Blank values stay unresolved rather than becoming ''.
 */
function withResolvedComponents(
  master: MasterLocation,
  resolved: NormalizedAddress,
  now: Date,
): MasterLocation {
  return MasterLocation.updated(master, {
    normalizedHouseNumber: resolved.houseNumber,
    normalizedRoad: resolved.road,
    normalizedSuburb: resolved.suburb,
    normalizedCity: resolved.city || UNRESOLVED_COMPONENT,
    normalizedState: resolved.state,
    normalizedPostalCode: resolved.postalCode,
    normalizedCountry: resolved.country || master.normalizedCountry,
    addressHash: master.addressHash,
    normalizedAddressLine: master.normalizedAddressLine ?? '',
    now,
  });
}
