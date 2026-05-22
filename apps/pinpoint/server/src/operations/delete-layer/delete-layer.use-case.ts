import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
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

import { asClientId } from '../../domain/tenancy/ids.js';
import { asLayerId } from '../../domain/layers/ids.js';
import { LayerDeleted } from '../../domain/layers/events/layer-deleted.event.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { DeleteLayerCommand } from './delete-layer.command.js';

export class DeleteLayerUseCase {
  static readonly requiredPermission = PinpointPermission.LayersLayerDelete;

  constructor(private readonly layers: LayerRepository) {}

  execute = (
    command: DeleteLayerCommand,
  ): Effect.Effect<Sealed<LayerDeleted>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const layers = this.layers;
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LayersLayerDelete}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const layerId = asLayerId(command.layerId.trim());
      const existing = yield* Effect.tryPromise({
        try: () => layers.findById(layerId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'LAYER_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!existing) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'LAYER_NOT_FOUND',
            message: `Layer '${layerId}' not found.`,
          }),
        );
      }
      if (existing.clientId !== clientId) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'LAYER_CLIENT_MISMATCH',
            message: 'Layer belongs to a different client.',
          }),
        );
      }

      const event = new LayerDeleted(scope, {
        layerId: existing.id,
        clientId: existing.clientId,
      });

      // Layer's children (features, property_sets, layer_partitions,
      // location_layer_associations, location_feature_associations) all
      // CASCADE on the layer_id FK, so this generally just works.
      return yield* commitDelete(existing, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
