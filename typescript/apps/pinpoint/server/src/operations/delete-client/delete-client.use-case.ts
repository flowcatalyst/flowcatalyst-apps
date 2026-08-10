/**
 * Delete a client. Heavy operation — clients are referenced by partitions,
 * locations, layers, master_locations, matching_configs. Postgres FKs use
 * the default `NO ACTION` policy so a delete with any child row in any
 * of those tables fails with a foreign-key violation, which propagates
 * out of the persist callback and rolls back the surrounding tx. The
 * caller is responsible for removing the child rows first (via the
 * relevant aggregate's own delete) — EXCEPT the client's partitions:
 * every client owns at least the seeded 'default' partition, so this
 * use case cascades partition deletes itself. A partition that still has
 * locations/matching-config children keeps its own FK protection, which
 * fails the whole tx exactly like before.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitDelete,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId } from '../../domain/tenancy/ids.js';
import { ClientDeleted } from '../../domain/tenancy/events/client-deleted.event.js';
import { PartitionDeleted } from '../../domain/tenancy/events/partition-deleted.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { DeleteClientCommand } from './delete-client.command.js';

export class DeleteClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientDelete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
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

    // Cascade the client's partitions first (same tx) — the seeded default
    // means every client has at least one. Partitions with their own
    // children still FK-fail, rolling back everything.
    const partitions = await this.partitions.listByClient(existing.id);
    for (const partition of partitions) {
      const partitionEvent = new PartitionDeleted(scope, {
        partitionId: partition.id,
        clientId: partition.clientId,
      });
      const deleted = await commitDelete(
        this.uow,
        this.registry,
        partition,
        partitionEvent,
        command,
      );
      if (isFailure(deleted)) return deleted;
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
