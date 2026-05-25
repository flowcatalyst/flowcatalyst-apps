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

import {
  LayerFeature,
  PROPERTY_VALUES_MAX,
} from '../../domain/layers/layer-feature.js';
import { asLayerFeatureId } from '../../domain/layers/ids.js';
import { LayerFeatureUpdated } from '../../domain/layers/events/layer-feature-updated.event.js';
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { UpdateLayerFeatureCommand } from './update-layer-feature.command.js';

export class UpdateLayerFeatureUseCase {
  static readonly requiredPermission = PinpointPermission.LayersFeatureUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly features: LayerFeatureRepository,
  ) {}

  async execute(command: UpdateLayerFeatureCommand): Promise<Result<LayerFeatureUpdated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersFeatureUpdate}.`,
        ),
      );
    }

    const featureId = asLayerFeatureId(command.featureId.trim());
    const label = command.label.trim();
    const propertyValues = command.propertyValues ?? {};

    if (label.length === 0) {
      return Result.failure(
        UseCaseError.validation('FEATURE_LABEL_REQUIRED', 'Feature label must not be empty.'),
      );
    }

    const hasPoint = command.centerLat != null && command.centerLon != null;
    const hasPolygon =
      command.polygonGeojson != null && command.polygonGeojson.trim().length > 0;
    if (!hasPoint && !hasPolygon) {
      return Result.failure(
        UseCaseError.validation(
          'FEATURE_GEOMETRY_REQUIRED',
          'Feature must have either a center point (lat/lon) or a polygon.',
        ),
      );
    }

    if (Object.keys(propertyValues).length > PROPERTY_VALUES_MAX) {
      return Result.failure(
        UseCaseError.validation(
          'FEATURE_TOO_MANY_PROPERTIES',
          `A feature can have at most ${PROPERTY_VALUES_MAX} property values.`,
        ),
      );
    }

    const prior = await this.features.findById(featureId);
    if (!prior) {
      return Result.failure(
        UseCaseError.notFound('FEATURE_NOT_FOUND', `Feature '${featureId}' not found.`),
      );
    }

    const updated = LayerFeature.update(prior, {
      label,
      centerLat: command.centerLat ?? null,
      centerLon: command.centerLon ?? null,
      radiusMeters: command.radiusMeters ?? null,
      polygonGeojson: command.polygonGeojson ?? null,
      propertyValues,
      now: new Date(),
    });
    const event = new LayerFeatureUpdated(scope, {
      featureId: prior.id,
      layerId: prior.layerId,
      label,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(UpdateLayerFeatureUseCase.requiredPermission);
  }
}
