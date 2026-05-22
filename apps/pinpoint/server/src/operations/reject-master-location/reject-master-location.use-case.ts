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
import { MasterLocationRejected } from '../../domain/locations/events/master-location-rejected.event.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { RejectMasterLocationCommand } from './reject-master-location.command.js';

export class RejectMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationReject;

  constructor(private readonly masters: MasterLocationRepository) {}

  execute = (
    command: RejectMasterLocationCommand,
  ): Effect.Effect<
    Sealed<MasterLocationRejected>,
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
            message: `Missing permission ${PinpointPermission.LocationsMasterLocationReject}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const masterLocationId = asMasterLocationId(command.masterLocationId.trim());
      const reason = command.reason?.trim() || null;

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
      if (existing.status === 'REJECTED') {
        // Idempotent: re-rejecting is a no-op success. Emit the event so
        // downstream consumers see the audit trail and the reason update.
      } else if (existing.status === 'VALIDATED') {
        // Rejecting a VALIDATED master un-canonicalises it. Tracked
        // intentionally — the BFF may want to gate this behind a stronger
        // confirmation, but at the use-case layer we allow it.
      }

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
