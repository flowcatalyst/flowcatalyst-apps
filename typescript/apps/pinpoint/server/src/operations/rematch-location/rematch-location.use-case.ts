/**
 * Rematch a location against an edited "match address".
 *
 * The location's received address (raw_address_line1) is immutable; its
 * match_address is editable. This use case sets the new match_address, tidies
 * it into the matching line, and re-runs the matching create-location uses
 * (`matchLocation`: exact hash, else verifier-checked candidates, against
 * VALIDATED masters):
 *   - matches a master → the location copies its data (MASTER_LOCATIONS),
 *     VALIDATED, features at its point.
 *   - no match → the location goes back to PENDING with nothing resolved, to
 *     be geocoded and approved on its own.
 *
 * Masters are reference data: nothing here creates or deletes one.
 */
import {
  Result,
  ScopeStore,
  TransactionStore,
  UseCaseError,
  commitAggregate,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId } from '../../domain/tenancy/ids.js';
import { asLocationId } from '../../domain/locations/ids.js';
import { LocationRematched } from '../../domain/locations/events/location-rematched.event.js';
import { addressLineHash, tidyAddressLine } from '../../domain/services/address-line.js';
import { matchLocation } from '../../domain/services/location-matching.js';
import {
  associateLocationFeatures,
  locationValidatedEvent,
} from '../../domain/services/location-features.js';
import { recordMatchTrail } from '../../domain/services/match-trail.js';
import { Location } from '../../domain/locations/location.js';
import type { AddressVerifier } from '../../domain/services/address-verifier.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { MatchingConfigRepository } from '../../domain/matching/matching-config.repository.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { ProcessingLogRepository } from '../../domain/locations/processing-log.repository.js';
import type { RematchLocationCommand } from './rematch-location.command.js';

export class RematchLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
    private readonly masters: MasterLocationRepository,
    private readonly matchingConfigs: MatchingConfigRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly processingLog: ProcessingLogRepository,
    private readonly addressVerifier: AddressVerifier,
  ) {}

  async execute(command: RematchLocationCommand): Promise<Result<LocationRematched>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsLocationUpdate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const locationId = asLocationId(command.locationId.trim());
    const matchAddress = command.matchAddress.trim();
    if (matchAddress.length === 0) {
      return Result.failure(
        UseCaseError.validation('MATCH_ADDRESS_REQUIRED', 'Match address must not be empty.'),
      );
    }

    const location = await this.locations.findById(locationId);
    if (!location) {
      return Result.failure(
        UseCaseError.notFound('LOCATION_NOT_FOUND', `Location '${locationId}' not found.`),
      );
    }
    if (location.clientId !== clientId) {
      return Result.failure(
        UseCaseError.businessRule(
          'LOCATION_CLIENT_MISMATCH',
          'Location belongs to a different client.',
        ),
      );
    }

    const previousMasterId = location.sourceMasterLocationId;
    const now = new Date();

    const addressLine = tidyAddressLine(matchAddress);
    const addressHash = addressLineHash(addressLine);

    const config = await this.matchingConfigs.resolve(clientId, location.partitionId);
    const outcome = await matchLocation(
      { masters: this.masters, verifier: this.addressVerifier },
      {
        clientId,
        partitionId: location.partitionId,
        addressLine,
        addressHash,
        name: location.name,
        locationId,
        threshold: config.overallThreshold,
      },
    );

    const edited: Location = { ...location, matchAddress, addressHash };
    const updated = outcome.match
      ? Location.matchedFrom(edited, outcome.match.master, outcome.match, now)
      : { ...Location.unmatched(edited, now), normalizedCountry: location.normalizedCountry };

    const event = new LocationRematched(scope, {
      locationId,
      clientId,
      matchAddress,
      previousSourceMasterLocationId: previousMasterId,
      sourceMasterLocationId: updated.sourceMasterLocationId,
      status: updated.status,
    });
    const rematched = await commitAggregate(this.uow, this.registry, updated, event, command);
    if (isFailure(rematched)) return rematched;

    await recordMatchTrail(this.processingLog, locationId, {
      addressLine,
      addressHash,
      countryHint: null,
      outcome,
      trigger: 'rematch',
    });

    // A match re-associates features at the copied point; no match clears them.
    const hits = await associateLocationFeatures(
      this.layerFeatures,
      updated,
      TransactionStore.get(),
    );
    if (outcome.match) {
      const validated = await commitAggregate(
        this.uow,
        this.registry,
        updated,
        locationValidatedEvent(scope, updated, hits),
        command,
      );
      if (isFailure(validated)) return Result.failure(validated.error);
    }

    return rematched;
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(RematchLocationUseCase.requiredPermission);
  }
}
