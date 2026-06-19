import { generateTsid } from '@flowcatalyst/sdk';
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
import { asClientId, asPartitionId, PARTITION_ID_PREFIX } from '../../domain/tenancy/ids.js';
import { PartitionCreated } from '../../domain/tenancy/events/partition-created.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { CreatePartitionCommand } from './create-partition.command.js';

export class CreatePartitionUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionCreate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
  ) {}

  async execute(command: CreatePartitionCommand): Promise<Result<PartitionCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.TenancyPartitionCreate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const code = command.code.trim();
    const name = command.name.trim();
    const description = command.description?.trim() || null;

    if (clientId.length === 0) {
      return Result.failure(
        UseCaseError.validation('PARTITION_CLIENT_REQUIRED', 'clientId must not be empty.'),
      );
    }
    if (code.length === 0) {
      return Result.failure(
        UseCaseError.validation('PARTITION_CODE_REQUIRED', 'Partition code must not be empty.'),
      );
    }
    if (name.length === 0) {
      return Result.failure(
        UseCaseError.validation('PARTITION_NAME_REQUIRED', 'Partition name must not be empty.'),
      );
    }

    const client = await this.clients.findById(clientId);
    if (!client) {
      return Result.failure(
        UseCaseError.notFound('CLIENT_NOT_FOUND', `Client '${clientId}' not found.`),
      );
    }

    const duplicate = await this.partitions.findByClientAndCode(clientId, code);
    if (duplicate) {
      return Result.failure(
        UseCaseError.businessRule(
          'PARTITION_CODE_EXISTS',
          `A partition with code '${code}' already exists for client '${clientId}'.`,
          { existingPartitionId: duplicate.id },
        ),
      );
    }

    const id = asPartitionId(`${PARTITION_ID_PREFIX}_${generateTsid()}`);
    const partition = Partition.create({
      id,
      clientId,
      code,
      name,
      description,
      now: new Date(),
    });
    const event = new PartitionCreated(scope, {
      partitionId: id,
      clientId,
      code,
      name,
    });

    return commitAggregate(this.uow, this.registry, partition, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreatePartitionUseCase.requiredPermission);
  }
}
