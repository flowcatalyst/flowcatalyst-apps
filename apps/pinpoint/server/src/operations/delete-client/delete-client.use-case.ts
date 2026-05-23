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
  NotFoundError,
  ScopeStore,
  type Scope,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { asClientId } from '../../domain/tenancy/ids.js';
import { ClientDeleted } from '../../domain/tenancy/events/client-deleted.event.js';
import { Clients } from '../../domain/tenancy/client.repository.js';
import type { DeleteClientCommand } from './delete-client.command.js';

export class DeleteClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientDelete;

  execute = (
    command: DeleteClientCommand,
  ): Effect.Effect<
    Sealed<ClientDeleted>,
    UseCaseError,
    UnitOfWork | AggregateRegistry | Clients
  > => {
    const authorize = (s: Scope): boolean => this.authorize(s);

    return Effect.gen(function* () {
      const scope = ScopeStore.require();
      const clients = yield* Clients;

      if (!authorize(scope)) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.TenancyClientDelete}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const existing = yield* clients.findById(clientId);
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

      return yield* commitDelete(existing, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
