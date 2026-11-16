/** An operator rejects a location (not a real / deliverable place): * → REJECTED. */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Location } from '../../domain/locations/location.js';
import { LocationRejected } from '../../domain/locations/events/location-rejected.event.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import { loadClientLocation, trail } from '../_shared/load-location.js';
import type { RejectLocationCommand } from './reject-location.command.js';

export class RejectLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationReject;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
    private readonly processingLog: ProcessingLogRepository,
  ) {}

  async execute(command: RejectLocationCommand): Promise<Result<LocationRejected>> {
    const scope = ScopeStore.require();
    if (!scope.permissions.has(RejectLocationUseCase.requiredPermission)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${RejectLocationUseCase.requiredPermission}.`,
        ),
      );
    }
    const loaded = await loadClientLocation(this.locations, command.clientId, command.locationId);
    if (!loaded.ok) return Result.failure(loaded.error);
    const location = loaded.location;
    const reason = command.reason?.trim() || null;
    const committed = await commitAggregate(
      this.uow,
      this.registry,
      Location.rejected(location, new Date()),
      new LocationRejected(scope, { locationId: location.id, clientId: location.clientId, reason }),
      command,
    );
    await trail(() =>
      this.processingLog.append({ locationId: location.id }, ProcessingStep.Rejected, { reason }),
    );
    return committed;
  }
}
