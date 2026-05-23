import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  commitAggregate,
  NotFoundError,
  ScopeStore,
  type Scope,
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
import { asLayerFeatureId } from '../../domain/layers/ids.js';
import { LayerFeatureUpdated } from '../../domain/layers/events/layer-feature-updated.event.js';
import { LayerFeatures } from '../../domain/layers/layer-feature.repository.js';
import type { UpdateLayerFeatureCommand } from './update-layer-feature.command.js';

export class UpdateLayerFeatureUseCase {
  static readonly requiredPermission = PinpointPermission.LayersFeatureUpdate;

  execute = (
    command: UpdateLayerFeatureCommand,
  ): Effect.Effect<
    Sealed<LayerFeatureUpdated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | LayerFeatures
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const features = yield* LayerFeatures;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LayersFeatureUpdate}.`,
          }),
        );
      }

      const featureId = asLayerFeatureId(command.featureId.trim());
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

      const prior = yield* features.findById(featureId);
      if (!prior) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'FEATURE_NOT_FOUND',
            message: `Feature '${featureId}' not found.`,
          }),
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

      return yield* commitAggregate(updated, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
