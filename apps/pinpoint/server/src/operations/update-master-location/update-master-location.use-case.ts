/**
 * Manually edit a master_location's normalized components — used by the
 * BFF "edit master" form when a human spots a libpostal misparse.
 * Recomputes `addressHash` + `normalizedAddressLine` from the new
 * components so future matches dedupe correctly.
 *
 * Doesn't touch status — that's `confirm-master-location` /
 * `reject-master-location`'s job.
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

  constructor(private readonly masters: MasterLocationRepository) {}

  execute = (
    command: UpdateMasterLocationCommand,
  ): Effect.Effect<
    Sealed<MasterLocationUpdated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry
  > => {
    const masters = this.masters;
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LocationsMasterLocationUpdate}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const masterLocationId = asMasterLocationId(command.masterLocationId.trim());

      const existing = yield* Effect.tryPromise({
        try: () => masters.findById(masterLocationId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'MASTER_LOCATION_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!existing) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'MASTER_LOCATION_NOT_FOUND',
            message: `Master location '${masterLocationId}' not found.`,
          }),
        );
      }
      if (existing.clientId !== clientId) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'MASTER_LOCATION_CLIENT_MISMATCH',
            message: 'Master location belongs to a different client.',
          }),
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

      return yield* commitAggregate(updated, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
