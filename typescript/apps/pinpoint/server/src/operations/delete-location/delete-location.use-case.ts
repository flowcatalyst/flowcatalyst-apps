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
import { asLocationId } from '../../domain/locations/ids.js';
import { LocationDeleted } from '../../domain/locations/events/location-deleted.event.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { DeleteLocationCommand } from './delete-location.command.js';

export class DeleteLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
  ) {}

  async execute(command: DeleteLocationCommand): Promise<Result<LocationDeleted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LocationsLocationDelete}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const locationId = asLocationId(command.locationId.trim());
    const existing = await this.locations.findById(locationId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound('LOCATION_NOT_FOUND', `Location '${locationId}' not found.`),
      );
    }
    if (existing.clientId !== clientId) {
      return Result.failure(
        UseCaseError.businessRule(
          'LOCATION_CLIENT_MISMATCH',
          'Location belongs to a different client.',
        ),
      );
    }

    // The location's feature/attribute/layer association rows cascade at the DB
    // level (ON DELETE CASCADE), so a single delete is sufficient.
    const event = new LocationDeleted(scope, {
      locationId: existing.id,
      clientId: existing.clientId,
      masterLocationId: existing.masterLocationId,
    });

    return commitDelete(this.uow, this.registry, existing, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(DeleteLocationUseCase.requiredPermission);
  }
}
