import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
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
import {
  asClientId,
  asPartitionId,
  PARTITION_ID_PREFIX,
} from '../../domain/tenancy/ids.js';
import { PartitionCreated } from '../../domain/tenancy/events/partition-created.event.js';
import { Clients } from '../../domain/tenancy/client.repository.js';
import { Partitions } from '../../domain/tenancy/partition.repository.js';
import type { CreatePartitionCommand } from './create-partition.command.js';

export class CreatePartitionUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyPartitionCreate;

  execute = (
    command: CreatePartitionCommand,
  ): Effect.Effect<
    Sealed<PartitionCreated>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | Clients | Partitions
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const clients = yield* Clients;
      const partitions = yield* Partitions;

      if (!authorize(scope)) {
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

      const client = yield* clients.findById(clientId);
      if (!client) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'CLIENT_NOT_FOUND',
            message: `Client '${clientId}' not found.`,
          }),
        );
      }

      const duplicate = yield* partitions.findByClientAndCode(clientId, code);
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

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
