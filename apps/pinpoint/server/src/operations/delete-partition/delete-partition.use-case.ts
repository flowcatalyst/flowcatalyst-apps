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

import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { PartitionDeleted } from '../../domain/tenancy/events/partition-deleted.event.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { DeletePartitionCommand } from './delete-partition.command.js';

export class DeletePartitionUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly partitions: PartitionRepository,
  ) {}

  async execute(command: DeletePartitionCommand): Promise<Result<PartitionDeleted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.TenancyPartitionDelete}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const partitionId = asPartitionId(command.partitionId.trim());
    const existing = await this.partitions.findById(partitionId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound('PARTITION_NOT_FOUND', `Partition '${partitionId}' not found.`),
      );
    }
    if (existing.clientId !== clientId) {
      return Result.failure(
        UseCaseError.businessRule(
          'PARTITION_CLIENT_MISMATCH',
          'Partition belongs to a different client.',
        ),
      );
    }

    const event = new PartitionDeleted(scope, {
      partitionId: existing.id,
      clientId: existing.clientId,
    });

    return commitDelete(this.uow, this.registry, existing, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(DeletePartitionUseCase.requiredPermission);
  }
}
