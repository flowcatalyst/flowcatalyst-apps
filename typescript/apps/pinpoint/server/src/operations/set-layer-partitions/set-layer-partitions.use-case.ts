import {
  Result,
  ScopeStore,
  TransactionStore,
  UseCaseError,
  emitEvent,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import { asLayerId } from '../../domain/layers/ids.js';
import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { LayerPartitionsSet } from '../../domain/layers/events/layer-partitions-set.event.js';
import type { LayerRepository } from '../../domain/layers/layer.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { SetLayerPartitionsCommand } from './set-layer-partitions.command.js';

/**
 * Replace the set of partitions a layer is visible to. Empty = every
 * partition of the client (the default). The `layer_partitions` rows are not
 * part of the Layer aggregate, so the write goes through the repository on
 * the unit-of-work transaction and the change is recorded with `emitEvent`.
 */
export class SetLayerPartitionsUseCase {
  static readonly requiredPermission = PinpointPermission.LayersLayerUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly layers: LayerRepository,
    private readonly partitions: PartitionRepository,
  ) {}

  async execute(command: SetLayerPartitionsCommand): Promise<Result<LayerPartitionsSet>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${SetLayerPartitionsUseCase.requiredPermission}.`,
        ),
      );
    }
    const clientId = asClientId(command.clientId.trim());
    const layerId = asLayerId(command.layerId.trim());
    const partitionIds = [...new Set(command.partitionIds.map((p) => p.trim()))];

    const layer = await this.layers.findById(layerId);
    if (!layer || layer.clientId !== clientId) {
      return Result.failure(
        UseCaseError.notFound('LAYER_NOT_FOUND', `Layer '${layerId}' not found.`),
      );
    }
    for (const pid of partitionIds) {
      const partition = await this.partitions.findById(asPartitionId(pid));
      if (!partition || partition.clientId !== clientId) {
        return Result.failure(
          UseCaseError.validation(
            'PARTITION_NOT_IN_CLIENT',
            `Partition '${pid}' does not belong to client '${clientId}'.`,
          ),
        );
      }
    }

    await this.layers.setPartitionIds(layerId, partitionIds, TransactionStore.get());
    const event = new LayerPartitionsSet(scope, { layerId, clientId, partitionIds });
    return emitEvent(this.uow, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(SetLayerPartitionsUseCase.requiredPermission);
  }
}
