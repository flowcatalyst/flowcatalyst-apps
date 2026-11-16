/**
 * Re-run the spatial feature match at a VALIDATED location's point (e.g.
 * after layers changed) and re-emit `location:validated` with the new layer
 * properties.
 */
import {
  Result,
  ScopeStore,
  TransactionStore,
  UseCaseError,
  emitEvent,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import type { LocationValidated } from '../../domain/locations/events/location-validated.event.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import {
  associateLocationFeatures,
  locationValidatedEvent,
} from '../../domain/services/location-features.js';
import { loadClientLocation, trail } from '../_shared/load-location.js';
import type { MatchLocationFeaturesCommand } from './match-location-features.command.js';

export class MatchLocationFeaturesUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationApprove;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly locations: LocationRepository,
    private readonly layerFeatures: LayerFeatureRepository,
    private readonly processingLog: ProcessingLogRepository,
  ) {}

  async execute(command: MatchLocationFeaturesCommand): Promise<Result<LocationValidated>> {
    const scope = ScopeStore.require();
    if (!scope.permissions.has(MatchLocationFeaturesUseCase.requiredPermission)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${MatchLocationFeaturesUseCase.requiredPermission}.`,
        ),
      );
    }
    const loaded = await loadClientLocation(this.locations, command.clientId, command.locationId);
    if (!loaded.ok) return Result.failure(loaded.error);
    const location = loaded.location;
    if (location.status !== 'VALIDATED' || location.latitude === null) {
      return Result.failure(
        UseCaseError.businessRule(
          'LOCATION_NOT_VALIDATED',
          'Only a VALIDATED location with coordinates has features to match.',
        ),
      );
    }
    const hits = await associateLocationFeatures(this.layerFeatures, location, TransactionStore.get());
    const result = await emitEvent(this.uow, locationValidatedEvent(scope, location, hits), command);
    await trail(() =>
      this.processingLog.append({ locationId: location.id }, ProcessingStep.SpatialMatched, {
        features: hits.map((h) => h.featureId),
      }),
    );
    return result;
  }
}
