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
import { asClientId } from '../../domain/tenancy/ids.js';
import { ClientUpdated } from '../../domain/tenancy/events/client-updated.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { UpdateClientCommand } from './update-client.command.js';

export class UpdateClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientUpdate;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
  ) {}

  async execute(command: UpdateClientCommand): Promise<Result<ClientUpdated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.TenancyClientUpdate}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const name = command.name.trim();
    if (name.length === 0) {
      return Result.failure(
        UseCaseError.validation('CLIENT_NAME_REQUIRED', 'Client name must not be empty.'),
      );
    }

    const existing = await this.clients.findById(clientId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound('CLIENT_NOT_FOUND', `Client '${clientId}' not found.`),
      );
    }

    const updated = Client.rename(existing, name, new Date());
    const event = new ClientUpdated(scope, {
      clientId: updated.id,
      name: updated.name,
      code: updated.code,
    });

    return commitAggregate(this.uow, this.registry, updated, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(UpdateClientUseCase.requiredPermission);
  }
}
