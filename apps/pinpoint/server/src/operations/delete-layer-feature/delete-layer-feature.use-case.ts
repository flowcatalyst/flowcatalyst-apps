import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  commitDelete,
  NotFoundError,
  ScopeStore,
  type Scope,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asLayerFeatureId } from '../../domain/layers/ids.js';
import { LayerFeatureDeleted } from '../../domain/layers/events/layer-feature-deleted.event.js';
import { LayerFeatures } from '../../domain/layers/layer-feature.repository.js';
import type { DeleteLayerFeatureCommand } from './delete-layer-feature.command.js';

export class DeleteLayerFeatureUseCase {
  static readonly requiredPermission = PinpointPermission.LayersFeatureDelete;

  execute = (
    command: DeleteLayerFeatureCommand,
  ): Effect.Effect<
    Sealed<LayerFeatureDeleted>,
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
            message: `Missing permission ${PinpointPermission.LayersFeatureDelete}.`,
          }),
        );
      }

      const featureId = asLayerFeatureId(command.featureId.trim());

      const prior = yield* features.findById(featureId);
      if (!prior) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'FEATURE_NOT_FOUND',
            message: `Feature '${featureId}' not found.`,
          }),
        );
      }

      const event = new LayerFeatureDeleted(scope, {
        featureId: prior.id,
        layerId: prior.layerId,
      });

      return yield* commitDelete(prior, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
