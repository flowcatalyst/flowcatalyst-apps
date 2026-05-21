import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitDelete,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import { PartitionDeleted } from '../../domain/tenancy/events/partition-deleted.event.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { DeletePartitionCommand } from './delete-partition.command.js';

export class DeletePartitionUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionDelete;

  constructor(private readonly partitions: PartitionRepository) {}

  execute = (
    command: DeletePartitionCommand,
  ): Effect.Effect<Sealed<PartitionDeleted>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const partitions = this.partitions;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.TenancyPartitionDelete}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const partitionId = asPartitionId(command.partitionId.trim());
      const existing = yield* Effect.tryPromise({
        try: () => partitions.findById(partitionId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'PARTITION_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
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

      // FK cascade rules (per Slice 2/3/4 schema):
      //   - locations.partition_id ON DELETE NO ACTION (will block delete)
      //   - principal_partitions.partition_id CASCADE
      //   - layer_partitions.partition_id CASCADE
      // The locations FK is the only blocker; if any location still
      // references the partition the InfrastructureError surfaces to the
      // route. Future polish can translate the specific FK violation into
      // a BusinessRuleViolation with friendlier messaging.
      return yield* commitDelete(existing, event, command);
    });
  };

  private authorize(): boolean {
    return true;
  }
}
