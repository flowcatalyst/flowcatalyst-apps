import { Effect } from 'effect';
import {
  AggregateRegistry,
  AuthorizationError,
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

import { Client } from '../../domain/tenancy/client.js';
import { asClientId } from '../../domain/tenancy/ids.js';
import { ClientUpdated } from '../../domain/tenancy/events/client-updated.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { UpdateClientCommand } from './update-client.command.js';

export class UpdateClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientUpdate;

  constructor(private readonly clients: ClientRepository) {}

  execute = (
    command: UpdateClientCommand,
  ): Effect.Effect<Sealed<ClientUpdated>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const clients = this.clients;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
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

      const updated = Client.rename(existing, name, new Date());
      const event = new ClientUpdated(scope, {
        clientId: updated.id,
        name: updated.name,
        code: updated.code,
      });

      return yield* commitAggregate(updated, event, command);
    });
  };

  private authorize(): boolean {
    return true;
  }
}
