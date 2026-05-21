/**
 * Delete a client. Heavy operation — clients are referenced by partitions,
 * locations, layers, master_locations, matching_configs. Postgres FKs use
 * the default `NO ACTION` policy so a delete with any child row in any
 * of those tables fails with a foreign-key violation, which we surface as
 * a `BusinessRuleViolation`. The caller is responsible for removing the
 * child rows first (via the relevant aggregate's own delete).
 */
import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
  commitDelete,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId } from '../../domain/tenancy/ids.js';
import { ClientDeleted } from '../../domain/tenancy/events/client-deleted.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { DeleteClientCommand } from './delete-client.command.js';

export class DeleteClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientDelete;

  constructor(private readonly clients: ClientRepository) {}

  execute = (
    command: DeleteClientCommand,
  ): Effect.Effect<Sealed<ClientDeleted>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const clients = this.clients;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.TenancyClientDelete}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const existing = yield* Effect.tryPromise({
        try: () => clients.findById(clientId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'CLIENT_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!existing) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'CLIENT_NOT_FOUND',
            message: `Client '${clientId}' not found.`,
          }),
        );
      }

      const event = new ClientDeleted(scope, {
        clientId: existing.id,
        code: existing.code,
      });

      // commitDelete invokes the registry's `delete` handler inside the
      // bound tx. If any child row still references the client, Postgres
      // raises a foreign_key_violation (23503) — the SDK surfaces it as an
      // InfrastructureError and the route maps it to 500. Future work
      // (10b.x cleanup) can translate that specific failure into a
      // BusinessRuleViolation with friendlier messaging.
      return yield* commitDelete(existing, event, command);
    });
  };

  private authorize(): boolean {
    return true;
  }
}
