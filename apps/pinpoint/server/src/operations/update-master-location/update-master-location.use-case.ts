/**
 * Manually edit a master_location's normalized components — used by the
 * BFF "edit master" form when a human spots a libpostal misparse.
 * Recomputes `addressHash` + `normalizedAddressLine` from the new
 * components so future matches dedupe correctly.
 *
 * Doesn't touch status — that's `confirm-master-location` /
 * `reject-master-location`'s job.
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
import { asClientId } from '../../domain/tenancy/ids.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { MasterLocationUpdated } from '../../domain/locations/events/master-location-updated.event.js';
import {
  addressHash as computeAddressHash,
  toAddressLine,
} from '../../domain/services/address-normalizer.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { UpdateMasterLocationCommand } from './update-master-location.command.js';

export class UpdateMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masters: MasterLocationRepository,
  ) {}

  async execute(command: UpdateMasterLocationCommand): Promise<Result<MasterLocationUpdated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsMasterLocationUpdate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const masterLocationId = asMasterLocationId(command.masterLocationId.trim());

    const existing = await this.masters.findById(masterLocationId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound(
          'MASTER_LOCATION_NOT_FOUND',
          `Master location '${masterLocationId}' not found.`,
        ),
      );
    }
    if (existing.clientId !== clientId) {
      return Result.failure(
        UseCaseError.businessRule(
          'MASTER_LOCATION_CLIENT_MISMATCH',
          'Master location belongs to a different client.',
        ),
      );
    }

    const normalized = {
      houseNumber: command.normalizedHouseNumber?.trim() || null,
      road: command.normalizedRoad?.trim() || null,
      suburb: command.normalizedSuburb?.trim() || null,
      city: command.normalizedCity.trim(),
      state: command.normalizedState?.trim() || null,
      postalCode: command.normalizedPostalCode?.trim() || null,
      country: command.normalizedCountry.trim(),
    };
    const newHash = computeAddressHash(normalized);
    const newAddressLine = toAddressLine(normalized);

    const updated = MasterLocation.updated(existing, {
      normalizedHouseNumber: normalized.houseNumber,
      normalizedRoad: normalized.road,
      normalizedSuburb: normalized.suburb,
      normalizedCity: normalized.city,
      normalizedState: normalized.state,
      normalizedPostalCode: normalized.postalCode,
      normalizedCountry: normalized.country,
      addressHash: newHash,
      normalizedAddressLine: newAddressLine,
      now: new Date(),
    });

    const event = new MasterLocationUpdated(scope, {
      masterLocationId: updated.id,
      clientId: updated.clientId,
      addressHash: updated.addressHash,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(UpdateMasterLocationUseCase.requiredPermission);
  }
}
