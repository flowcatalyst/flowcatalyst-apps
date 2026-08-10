import { generateTsid } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Client } from '../../domain/tenancy/client.js';
import { DEFAULT_PARTITION_CODE, Partition } from '../../domain/tenancy/partition.js';
import {
  asClientId,
  asPartitionId,
  CLIENT_ID_PREFIX,
  PARTITION_ID_PREFIX,
} from '../../domain/tenancy/ids.js';
import { ClientCreated } from '../../domain/tenancy/events/client-created.event.js';
import { PartitionCreated } from '../../domain/tenancy/events/partition-created.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { CreateClientCommand } from './create-client.command.js';

export class CreateClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientCreate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
  ) {}

  async execute(command: CreateClientCommand): Promise<Result<ClientCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.TenancyClientCreate}.`,
        ),
      );
    }

    const name = command.name.trim();
    const code = command.code.trim();

    if (name.length === 0) {
      return Result.failure(
        UseCaseError.validation('CLIENT_NAME_REQUIRED', 'Client name must not be empty.'),
      );
    }
    if (code.length === 0) {
      return Result.failure(
        UseCaseError.validation('CLIENT_CODE_REQUIRED', 'Client code must not be empty.'),
      );
    }

    const existing = await this.clients.findByCode(code);
    if (existing) {
      return Result.failure(
        UseCaseError.businessRule(
          'CLIENT_CODE_EXISTS',
          `A client with code '${code}' already exists.`,
          { existingClientId: existing.id },
        ),
      );
    }

    const id = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    const client = Client.create({ id, name, code, now: new Date() });
    const event = new ClientCreated(scope, { clientId: id, name, code });

    const clientResult = await commitAggregate(this.uow, this.registry, client, event, command);
    if (isFailure(clientResult)) return clientResult;

    // Every client gets a 'default' partition (cascade in the same tx) —
    // locations always land in a partition, so a default must always exist.
    const partitionId = asPartitionId(`${PARTITION_ID_PREFIX}_${generateTsid()}`);
    const partition = Partition.create({
      id: partitionId,
      clientId: id,
      code: DEFAULT_PARTITION_CODE,
      name: 'Default',
      description: 'Seeded default partition.',
      now: new Date(),
    });
    const partitionEvent = new PartitionCreated(scope, {
      partitionId,
      clientId: id,
      code: DEFAULT_PARTITION_CODE,
      name: 'Default',
    });
    const partitionResult = await commitAggregate(
      this.uow,
      this.registry,
      partition,
      partitionEvent,
      command,
    );
    if (isFailure(partitionResult)) return partitionResult;

    return clientResult;
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateClientUseCase.requiredPermission);
  }
}
