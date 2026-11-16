/**
 * Dismiss a delivery-capture disagreement after an operator looked at it
 * (they may have corrected the location, or decided it is right).
 */
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
import { LocationCaptureReviewCleared } from '../../domain/locations/events/location-capture-review-cleared.event.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import { loadClientLocation } from '../_shared/load-location.js';
import type { ClearLocationCaptureReviewCommand } from './clear-location-capture-review.command.js';

export class ClearLocationCaptureReviewUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationApprove;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly locations: LocationRepository,
  ) {}

  async execute(
    command: ClearLocationCaptureReviewCommand,
  ): Promise<Result<LocationCaptureReviewCleared>> {
    const scope = ScopeStore.require();
    if (!scope.permissions.has(ClearLocationCaptureReviewUseCase.requiredPermission)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${ClearLocationCaptureReviewUseCase.requiredPermission}.`,
        ),
      );
    }
    const loaded = await loadClientLocation(this.locations, command.clientId, command.locationId);
    if (!loaded.ok) return Result.failure(loaded.error);
    const location = loaded.location;
    if (location.captureReview === null) {
      return Result.failure(
        UseCaseError.businessRule('NO_CAPTURE_REVIEW', 'Location has no capture disagreement.'),
      );
    }
    return commitAggregate(
      this.uow,
      this.registry,
      Location.captureReviewCleared(location, new Date()),
      new LocationCaptureReviewCleared(scope, {
        locationId: location.id,
        clientId: location.clientId,
        masterLocationId: location.captureMasterLocationId,
      }),
      command,
    );
  }
}
