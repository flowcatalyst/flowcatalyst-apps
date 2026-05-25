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

import { Partition } from '../../domain/tenancy/partition.js';
import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { PartitionUpdated } from '../../domain/tenancy/events/partition-updated.event.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { UpdatePartitionCommand } from './update-partition.command.js';

export class UpdatePartitionUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly partitions: PartitionRepository,
  ) {}

  async execute(command: UpdatePartitionCommand): Promise<Result<PartitionUpdated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.TenancyPartitionUpdate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const partitionId = asPartitionId(command.partitionId.trim());
    const name = command.name.trim();
    const description = command.description?.trim() || null;
    if (name.length === 0) {
      return Result.failure(
        UseCaseError.validation('PARTITION_NAME_REQUIRED', 'Partition name must not be empty.'),
      );
    }

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

    const updated = Partition.update(existing, { name, description, now: new Date() });
    const event = new PartitionUpdated(scope, {
      partitionId: updated.id,
      clientId: updated.clientId,
      name: updated.name,
      description: updated.description,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(UpdatePartitionUseCase.requiredPermission);
  }
}
