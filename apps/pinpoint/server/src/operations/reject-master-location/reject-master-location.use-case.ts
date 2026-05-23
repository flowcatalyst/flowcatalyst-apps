/**
 * Mark a master_location as REJECTED (junk, duplicate, manual override).
 * The matching pipeline (Slice 8) filters REJECTED masters out of
 * candidate lookups — so this hides the master from future automatic
 * matches without losing the row.
 */
import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
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
import { MasterLocationRejected } from '../../domain/locations/events/master-location-rejected.event.js';
import { MasterLocations } from '../../domain/locations/master-location.repository.js';
import type { RejectMasterLocationCommand } from './reject-master-location.command.js';

export class RejectMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationReject;

  execute = (
    command: RejectMasterLocationCommand,
  ): Effect.Effect<
    Sealed<MasterLocationRejected>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | MasterLocations
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const masters = yield* MasterLocations;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LocationsMasterLocationReject}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const masterLocationId = asMasterLocationId(command.masterLocationId.trim());
      const reason = command.reason?.trim() || null;

      const existing = yield* masters.findById(masterLocationId);
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
      // Re-rejecting is idempotent. Re-rejecting a VALIDATED master
      // un-canonicalises it — gated at the BFF layer if desired.

      const updated = MasterLocation.rejected(existing, new Date());
      const event = new MasterLocationRejected(scope, {
        masterLocationId: updated.id,
        clientId: updated.clientId,
        reason,
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
