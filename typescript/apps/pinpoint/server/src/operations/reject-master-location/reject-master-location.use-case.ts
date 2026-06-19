/**
 * Mark a master_location as REJECTED (junk, duplicate, manual override).
 * The matching pipeline (Slice 8) filters REJECTED masters out of
 * candidate lookups — so this hides the master from future automatic
 * matches without losing the row.
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
import { MasterLocationRejected } from '../../domain/locations/events/master-location-rejected.event.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { RejectMasterLocationCommand } from './reject-master-location.command.js';

export class RejectMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationReject;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masters: MasterLocationRepository,
  ) {}

  async execute(command: RejectMasterLocationCommand): Promise<Result<MasterLocationRejected>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsMasterLocationReject}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const masterLocationId = asMasterLocationId(command.masterLocationId.trim());
    const reason = command.reason?.trim() || null;

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
    // Re-rejecting is idempotent. Re-rejecting a VALIDATED master
    // un-canonicalises it — gated at the BFF layer if desired.

    const updated = MasterLocation.rejected(existing, new Date());
    const event = new MasterLocationRejected(scope, {
      masterLocationId: updated.id,
      clientId: updated.clientId,
      reason,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(RejectMasterLocationUseCase.requiredPermission);
  }
}
