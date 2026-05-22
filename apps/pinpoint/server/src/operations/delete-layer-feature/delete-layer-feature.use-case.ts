import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  commitDelete,
  InfrastructureError,
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
import type { LayerFeatureRepository } from '../../domain/layers/layer-feature.repository.js';
import type { DeleteLayerFeatureCommand } from './delete-layer-feature.command.js';

/**
 * First use case in the codebase to exercise `commitDelete`. The pattern
 * mirrors `commitAggregate` but signals removal intent — the registry's
 * `delete` handler runs inside the same Drizzle tx as the outbox write.
 */
export class DeleteLayerFeatureUseCase {
  static readonly requiredPermission = PinpointPermission.LayersFeatureDelete;

  constructor(private readonly features: LayerFeatureRepository) {}

  execute = (
    command: DeleteLayerFeatureCommand,
  ): Effect.Effect<Sealed<LayerFeatureDeleted>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const features = this.features;
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LayersFeatureDelete}.`,
          }),
        );
      }

      const featureId = asLayerFeatureId(command.featureId.trim());

      const prior = yield* Effect.tryPromise({
        try: () => features.findById(featureId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'LAYER_FEATURE_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
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
