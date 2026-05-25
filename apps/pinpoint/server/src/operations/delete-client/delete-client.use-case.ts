/**
 * Delete a client. Heavy operation — clients are referenced by partitions,
 * locations, layers, master_locations, matching_configs. Postgres FKs use
 * the default `NO ACTION` policy so a delete with any child row in any
 * of those tables fails with a foreign-key violation, which propagates
 * out of the persist callback and rolls back the surrounding tx. The
 * caller is responsible for removing the child rows first (via the
 * relevant aggregate's own delete).
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitDelete,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId } from '../../domain/tenancy/ids.js';
import { ClientDeleted } from '../../domain/tenancy/events/client-deleted.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { DeleteClientCommand } from './delete-client.command.js';

export class DeleteClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
  ) {}

  async execute(command: DeleteClientCommand): Promise<Result<ClientDeleted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.TenancyClientDelete}.`,
        ),
      );
    }

    const clientId = asClientId(command.clientId.trim());
    const existing = await this.clients.findById(clientId);
    if (!existing) {
      return Result.failure(
        UseCaseError.notFound('CLIENT_NOT_FOUND', `Client '${clientId}' not found.`),
      );
    }

    const event = new ClientDeleted(scope, {
      clientId: existing.id,
      code: existing.code,
    });

    return commitDelete(this.uow, this.registry, existing, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(DeleteClientUseCase.requiredPermission);
  }
}
