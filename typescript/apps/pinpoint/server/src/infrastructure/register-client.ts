import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { CLIENT_TYPE, type Client } from '../domain/tenancy/client.js';
import type { ClientRepository } from '../domain/tenancy/client.repository.js';

/**
 * Wire the Client aggregate into the shared AggregateRegistry so use cases
 * yielding `commitAggregate(client, ...)` resolve to this repository at
 * persist time.
 */
export function registerClient(
  registry: AggregateRegistryImpl,
  repository: ClientRepository,
): void {
  registry.register(createAggregateHandler<Client>(CLIENT_TYPE, repository));
}
