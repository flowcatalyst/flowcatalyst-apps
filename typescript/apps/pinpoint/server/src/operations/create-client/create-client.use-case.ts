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

import { Client } from '../../domain/tenancy/client.js';
import { asClientId, CLIENT_ID_PREFIX } from '../../domain/tenancy/ids.js';
import { ClientCreated } from '../../domain/tenancy/events/client-created.event.js';
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

    return commitAggregate(this.uow, this.registry, client, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateClientUseCase.requiredPermission);
  }
}
