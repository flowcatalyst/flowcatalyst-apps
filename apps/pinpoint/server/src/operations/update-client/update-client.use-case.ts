import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
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

import { Client } from '../../domain/tenancy/client.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { ClientUpdated } from '../../domain/tenancy/events/client-updated.event.js';
import { Clients } from '../../domain/tenancy/client.repository.js';
import type { UpdateClientCommand } from './update-client.command.js';

/**
 * Prototype of the repo-as-Effect-Tag pattern. The repo (`Clients`) is
 * yielded from the Effect environment instead of being injected via
 * the constructor; the per-call `Effect.tryPromise({ try, catch })`
 * boilerplate is gone because the Tag's methods are already
 * Effect-typed. The Effect's requirement set advertises the
 * dependency (`UnitOfWork | AggregateRegistry | Clients`) so a use
 * case can no longer accidentally need a service it didn't declare.
 *
 * Compare with the rest of the use cases that still inject the repo
 * via constructor — the difference is roughly 5 lines saved per repo
 * call site (no try/catch wrap), plus the dependency surfaces in the
 * type.
 */
export class UpdateClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientUpdate;

  execute = (
    command: UpdateClientCommand,
  ): Effect.Effect<
    Sealed<ClientUpdated>,
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
            message: `Missing permission ${PinpointPermission.TenancyClientUpdate}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const name = command.name.trim();
      if (name.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'CLIENT_NAME_REQUIRED',
            message: 'Client name must not be empty.',
          }),
        );
      }

      const existing = yield* clients.findById(clientId);
      if (!existing) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'CLIENT_NOT_FOUND',
            message: `Client '${clientId}' not found.`,
          }),
        );
      }

      const updated = Client.rename(existing, name, new Date());
      const event = new ClientUpdated(scope, {
        clientId: updated.id,
        name: updated.name,
        code: updated.code,
      });

      return yield* commitAggregate(updated, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
