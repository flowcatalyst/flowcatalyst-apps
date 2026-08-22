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
import { PartitionAccessGranted } from '../../domain/tenancy/events/partition-access-granted.event.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { PrincipalRepository } from '../../domain/auth/principal.repository.js';
import type { GrantPartitionAccessCommand } from './grant-partition-access.command.js';

/** Grant a principal access to a partition (idempotent). */
export class GrantPartitionAccessUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly partitions: PartitionRepository,
    private readonly principals: PrincipalRepository,
  ) {}

  async execute(command: GrantPartitionAccessCommand): Promise<Result<PartitionAccessGranted>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${GrantPartitionAccessUseCase.requiredPermission}.`,
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
    const principal = await this.principals.findById(principalId);
    if (!principal) {
      return Result.failure(
        UseCaseError.notFound('PRINCIPAL_NOT_FOUND', `Principal '${principalId}' not found.`),
      );
    }

    const grantedBy = asPrincipalId(scope.principalId);
    await this.principals.grantPartitionAccess(
      principalId,
      partitionId,
      grantedBy,
      TransactionStore.get(),
    );
    const event = new PartitionAccessGranted(scope, {
      partitionId,
      clientId,
      principalId,
      grantedBy,
    });
    return emitEvent(this.uow, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(GrantPartitionAccessUseCase.requiredPermission);
  }
}
