import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  NotFoundError,
  ScopeStore,
  type Scope,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Partition } from '../../domain/tenancy/partition.js';
import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { PartitionUpdated } from '../../domain/tenancy/events/partition-updated.event.js';
import { Partitions } from '../../domain/tenancy/partition.repository.js';
import type { UpdatePartitionCommand } from './update-partition.command.js';

export class UpdatePartitionUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionUpdate;

  execute = (
    command: UpdatePartitionCommand,
  ): Effect.Effect<
    Sealed<PartitionUpdated>,
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
            message: `Missing permission ${PinpointPermission.TenancyPartitionUpdate}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const partitionId = asPartitionId(command.partitionId.trim());
      const name = command.name.trim();
      const description = command.description?.trim() || null;
      if (name.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'PARTITION_NAME_REQUIRED',
            message: 'Partition name must not be empty.',
          }),
        );
      }

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

      const updated = Partition.update(existing, { name, description, now: new Date() });
      const event = new PartitionUpdated(scope, {
        partitionId: updated.id,
        clientId: updated.clientId,
        name: updated.name,
        description: updated.description,
      });

      return yield* commitAggregate(updated, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
