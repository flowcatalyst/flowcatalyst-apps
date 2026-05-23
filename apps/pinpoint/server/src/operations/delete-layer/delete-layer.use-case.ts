import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitDelete,
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
import { Layers } from '../../domain/layers/layer.repository.js';
import type { DeleteLayerCommand } from './delete-layer.command.js';

export class DeleteLayerUseCase {
  static readonly requiredPermission = PinpointPermission.LayersLayerDelete;

  execute = (
    command: DeleteLayerCommand,
  ): Effect.Effect<
    Sealed<LayerDeleted>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | Layers
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const layers = yield* Layers;

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
      const existing = yield* layers.findById(layerId);
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

      return yield* commitDelete(existing, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
