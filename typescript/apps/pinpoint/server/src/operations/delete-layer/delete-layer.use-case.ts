import {
  Result,
  ScopeStore,
  UseCaseError,
  commitDelete,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId } from '../../domain/tenancy/ids.js';
import { asLayerId } from '../../domain/layers/ids.js';
import { LayerDeleted } from '../../domain/layers/events/layer-deleted.event.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { DeleteLayerCommand } from './delete-layer.command.js';

export class DeleteLayerUseCase {
  static readonly requiredPermission = PinpointPermission.LayersLayerDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly layers: LayerRepository,
  ) {}

  async execute(command: DeleteLayerCommand): Promise<Result<LayerDeleted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.LayersLayerDelete}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const layerId = asLayerId(command.layerId.trim());
    const existing = await this.layers.findById(layerId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound('LAYER_NOT_FOUND', `Layer '${layerId}' not found.`),
      );
    }
    if (existing.clientId !== clientId) {
      return Result.failure(
        UseCaseError.businessRule('LAYER_CLIENT_MISMATCH', 'Layer belongs to a different client.'),
      );
    }

    const event = new LayerDeleted(scope, {
      layerId: existing.id,
      clientId: existing.clientId,
    });

    return commitDelete(this.uow, this.registry, existing, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(DeleteLayerUseCase.requiredPermission);
  }
}
