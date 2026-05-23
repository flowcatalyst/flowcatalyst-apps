import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  ScopeStore,
  type Scope,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Client } from '../../domain/tenancy/client.js';
import { asClientId, CLIENT_ID_PREFIX } from '../../domain/tenancy/ids.js';
import { ClientCreated } from '../../domain/tenancy/events/client-created.event.js';
import { Clients } from '../../domain/tenancy/client.repository.js';
import type { CreateClientCommand } from './create-client.command.js';

export class CreateClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientCreate;

  execute = (
    command: CreateClientCommand,
  ): Effect.Effect<
    Sealed<ClientCreated>,
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
            message: `Missing permission ${PinpointPermission.TenancyClientCreate}.`,
          }),
        );
      }

      const name = command.name.trim();
      const code = command.code.trim();

      if (name.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'CLIENT_NAME_REQUIRED',
            message: 'Client name must not be empty.',
          }),
        );
      }
      if (code.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'CLIENT_CODE_REQUIRED',
            message: 'Client code must not be empty.',
          }),
        );
      }

      const existing = yield* clients.findByCode(code);
      if (existing) {
        return yield* Effect.fail(
          new BusinessRuleViolation({
            code: 'CLIENT_CODE_EXISTS',
            message: `A client with code '${code}' already exists.`,
            details: { existingClientId: existing.id },
          }),
        );
      }

      const id = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
      const client = Client.create({ id, name, code, now: new Date() });
      const event = new ClientCreated(scope, { clientId: id, name, code });

      return yield* commitAggregate(client, event, command);
    });
  };

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(
      (this.constructor as unknown as { readonly requiredPermission: string }).requiredPermission,
    );
  }
}
