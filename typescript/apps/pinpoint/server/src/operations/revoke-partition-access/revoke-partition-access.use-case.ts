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
import { asPrincipalId } from '../../domain/auth/ids.js';
import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { PartitionAccessRevoked } from '../../domain/tenancy/events/partition-access-revoked.event.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { PrincipalRepository } from '../../domain/auth/principal.repository.js';
import type { RevokePartitionAccessCommand } from './revoke-partition-access.command.js';

/** Revoke a principal's access to a partition. Not-found when there was no grant. */
export class RevokePartitionAccessUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly partitions: PartitionRepository,
    private readonly principals: PrincipalRepository,
  ) {}

  async execute(command: RevokePartitionAccessCommand): Promise<Result<PartitionAccessRevoked>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${RevokePartitionAccessUseCase.requiredPermission}.`,
        ),
      );
    }
    const clientId = asClientId(command.clientId.trim());
    const partitionId = asPartitionId(command.partitionId.trim());
    const principalId = asPrincipalId(command.principalId.trim());

    const partition = await this.partitions.findById(partitionId);
    if (!partition || partition.clientId !== clientId) {
      return Result.failure(
        UseCaseError.notFound('PARTITION_NOT_FOUND', `Partition '${partitionId}' not found.`),
      );
    }
    const revoked = await this.principals.revokePartitionAccess(
      principalId,
      partitionId,
      TransactionStore.get(),
    );
    if (!revoked) {
      return Result.failure(
        UseCaseError.notFound(
          'PARTITION_ACCESS_NOT_FOUND',
          `Principal '${principalId}' has no access grant on partition '${partitionId}'.`,
        ),
      );
    }
    const event = new PartitionAccessRevoked(scope, {
      partitionId,
      clientId,
      principalId,
      revokedBy: scope.principalId,
    });
    return emitEvent(this.uow, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(RevokePartitionAccessUseCase.requiredPermission);
  }
}
