import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  AggregateRegistry,
  AuthorizationError,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
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
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { CreateLayerFeatureCommand } from './create-layer-feature.command.js';

export class CreateLayerFeatureUseCase {
  static readonly requiredPermission = PinpointPermission.LayersFeatureCreate;

  constructor(
    private readonly layers: LayerRepository,
    private readonly features: LayerFeatureRepository,
  ) {}

  execute = (
    command: CreateLayerFeatureCommand,
  ): Effect.Effect<Sealed<LayerFeatureCreated>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const layers = this.layers;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LayersFeatureCreate}.`,
          }),
        );
      }

      const layerId = asLayerId(command.layerId.trim());
      const label = command.label.trim();
      const propertyValues = command.propertyValues ?? {};

      if (label.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'FEATURE_LABEL_REQUIRED',
            message: 'Feature label must not be empty.',
          }),
        );
      }

      const hasPoint = command.centerLat != null && command.centerLon != null;
      const hasPolygon =
        command.polygonGeojson != null && command.polygonGeojson.trim().length > 0;
      if (!hasPoint && !hasPolygon) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'FEATURE_GEOMETRY_REQUIRED',
            message: 'Feature must have either a center point (lat/lon) or a polygon.',
          }),
        );
      }

      if (Object.keys(propertyValues).length > PROPERTY_VALUES_MAX) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'FEATURE_TOO_MANY_PROPERTIES',
            message: `A feature can have at most ${PROPERTY_VALUES_MAX} property values.`,
          }),
        );
      }

      const layer = yield* Effect.tryPromise({
        try: () => layers.findById(layerId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'LAYER_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!layer) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'LAYER_NOT_FOUND',
            message: `Layer '${layerId}' not found.`,
          }),
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

      return yield* commitAggregate(feature, event, command);
    });
  };

  private authorize(): boolean {
    // TODO(auth): real permission check.
    return true;
  }
}
