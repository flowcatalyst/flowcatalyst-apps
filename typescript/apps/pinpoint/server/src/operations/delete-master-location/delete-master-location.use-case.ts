import {
  Result,
  ScopeStore,
  UseCaseError,
  commitDelete,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId } from '../../domain/tenancy/ids.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { MasterLocationDeleted } from '../../domain/locations/events/master-location-deleted.event.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import type { DeleteMasterLocationCommand } from './delete-master-location.command.js';

/**
 * Delete a master location (its processing trail cascades). Locations that
 * copied its data keep their copy — they only referenced it.
 */
export class DeleteMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masterLocations: MasterLocationRepository,
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

    const event = new MasterLocationDeleted(scope, {
      masterLocationId: existing.id,
      clientId: existing.clientId,
    });

    return commitDelete(this.uow, this.registry, existing, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(DeleteMasterLocationUseCase.requiredPermission);
  }
}
