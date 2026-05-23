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

import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { PartitionDeleted } from '../../domain/tenancy/events/partition-deleted.event.js';
import { Partitions } from '../../domain/tenancy/partition.repository.js';
import type { DeletePartitionCommand } from './delete-partition.command.js';

export class DeletePartitionUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionDelete;

  execute = (
    command: DeletePartitionCommand,
  ): Effect.Effect<
    Sealed<PartitionDeleted>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | Partitions
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const partitions = yield* Partitions;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.TenancyPartitionDelete}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const partitionId = asPartitionId(command.partitionId.trim());
      const existing = yield* partitions.findById(partitionId);
      if (!existing) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'PARTITION_NOT_FOUND',
            message: `Partition '${partitionId}' not found.`,
          }),
        );
      }
      if (existing.clientId !== clientId) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'PARTITION_CLIENT_MISMATCH',
            message: 'Partition belongs to a different client.',
          }),
        );
      }

      const event = new PartitionDeleted(scope, {
        partitionId: existing.id,
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
