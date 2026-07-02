import {
  Result,
  ScopeStore,
  UseCaseError,
  commitDelete,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId } from '../../domain/tenancy/ids.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { LocationDeleted } from '../../domain/locations/events/location-deleted.event.js';
import { MasterLocationDeleted } from '../../domain/locations/events/master-location-deleted.event.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { DeleteMasterLocationCommand } from './delete-master-location.command.js';

/**
 * Delete a master location AND its child locations (a cascade). The
 * `locations.master_location_id` FK is NOT `ON DELETE CASCADE`, so the child
 * locations must be deleted explicitly first — each one cascades its own
 * feature/attribute/layer association rows at the DB level. The master
 * location's processing-log rows then cascade via their own FK. Everything runs
 * inside the caller's single `runWrite` transaction, so it's atomic.
 */
export class DeleteMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masterLocations: MasterLocationRepository,
    private readonly locations: LocationRepository,
  ) {}

  async execute(command: DeleteMasterLocationCommand): Promise<Result<MasterLocationDeleted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsMasterLocationDelete}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const masterLocationId = asMasterLocationId(command.masterLocationId.trim());
    const existing = await this.masterLocations.findById(masterLocationId);
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

    // Cascade: delete every child location first (each cascades its own
    // associations via DB FK). Short-circuit on the first failure — the whole
    // tx rolls back.
    const children = await this.locations.listByMaster(masterLocationId);
    for (const child of children) {
      const childEvent = new LocationDeleted(scope, {
        locationId: child.id,
        clientId: child.clientId,
        masterLocationId: child.masterLocationId,
      });
      const childResult = await commitDelete(this.uow, this.registry, child, childEvent, command);
      if (isFailure(childResult)) return childResult;
    }

    const event = new MasterLocationDeleted(scope, {
      masterLocationId: existing.id,
      clientId: existing.clientId,
      locationsDeleted: children.length,
    });

    return commitDelete(this.uow, this.registry, existing, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(DeleteMasterLocationUseCase.requiredPermission);
  }
}
