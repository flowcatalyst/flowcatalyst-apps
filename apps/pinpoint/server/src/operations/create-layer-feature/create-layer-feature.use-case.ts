import { generateTsid } from '@flowcatalyst/sdk';
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
import {
  asLayerFeatureId,
  asLayerId,
  LAYER_FEATURE_ID_PREFIX,
} from '../../domain/layers/ids.js';
import { LayerFeatureCreated } from '../../domain/layers/events/layer-feature-created.event.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { CreateLayerFeatureCommand } from './create-layer-feature.command.js';

export class CreateLayerFeatureUseCase {
  static readonly requiredPermission = PinpointPermission.LayersFeatureCreate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly layers: LayerRepository,
  ) {}

  async execute(command: CreateLayerFeatureCommand): Promise<Result<LayerFeatureCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersFeatureCreate}.`,
        ),
      );
    }

    const layerId = asLayerId(command.layerId.trim());
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

    const layer = await this.layers.findById(layerId);
    if (!layer) {
      return Result.failure(
        UseCaseError.notFound('LAYER_NOT_FOUND', `Layer '${layerId}' not found.`),
      );
    }

    const id = asLayerFeatureId(`${LAYER_FEATURE_ID_PREFIX}_${generateTsid()}`);
    const feature = LayerFeature.create({
      id,
      layerId,
      label,
      centerLat: command.centerLat ?? null,
      centerLon: command.centerLon ?? null,
      radiusMeters: command.radiusMeters ?? null,
      polygonGeojson: command.polygonGeojson ?? null,
      propertyValues,
      now: new Date(),
    });
    const event = new LayerFeatureCreated(scope, {
      featureId: id,
      layerId,
      label,
    });

    return commitAggregate(this.uow, this.registry, feature, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateLayerFeatureUseCase.requiredPermission);
  }
}
