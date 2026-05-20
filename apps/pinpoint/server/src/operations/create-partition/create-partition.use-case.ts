import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Partition } from '../../domain/tenancy/partition.js';
import {
  asClientId,
  asPartitionId,
  PARTITION_ID_PREFIX,
} from '../../domain/tenancy/ids.js';
import { PartitionCreated } from '../../domain/tenancy/events/partition-created.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { CreatePartitionCommand } from './create-partition.command.js';

export class CreatePartitionUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionCreate;

  constructor(
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
  ) {}

  execute = (
    command: CreatePartitionCommand,
  ): Effect.Effect<Sealed<PartitionCreated>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const clients = this.clients;
    const partitions = this.partitions;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.TenancyPartitionCreate}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const code = command.code.trim();
      const name = command.name.trim();
      const description = command.description?.trim() || null;

      if (clientId.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'PARTITION_CLIENT_REQUIRED',
            message: 'clientId must not be empty.',
          }),
        );
      }
      if (code.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'PARTITION_CODE_REQUIRED',
            message: 'Partition code must not be empty.',
          }),
        );
      }
      if (name.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'PARTITION_NAME_REQUIRED',
            message: 'Partition name must not be empty.',
          }),
        );
      }

      const client = yield* Effect.tryPromise({
        try: () => clients.findById(clientId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'CLIENT_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!client) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'CLIENT_NOT_FOUND',
            message: `Client '${clientId}' not found.`,
          }),
        );
      }

      const duplicate = yield* Effect.tryPromise({
        try: () => partitions.findByClientAndCode(clientId, code),
        catch: (cause) =>
          new InfrastructureError({
            code: 'PARTITION_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (duplicate) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'PARTITION_CODE_EXISTS',
            message: `A partition with code '${code}' already exists for client '${clientId}'.`,
            details: { existingPartitionId: duplicate.id },
          }),
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

      return yield* commitAggregate(partition, event, command);
    });
  };

  private authorize(): boolean {
    // TODO(auth): real permission check.
    return true;
  }
}
