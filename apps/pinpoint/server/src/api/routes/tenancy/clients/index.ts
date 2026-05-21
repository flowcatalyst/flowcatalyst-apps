import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerCreateClientRoute } from './create-client.route.js';
import { registerDeleteClientRoute } from './delete-client.route.js';
import { registerGetClientRoute } from './get-client.route.js';
import { registerListClientsRoute } from './list-clients.route.js';
import { registerUpdateClientRoute } from './update-client.route.js';

export function registerClientRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerCreateClientRoute(fastify, appContext);
  registerListClientsRoute(fastify, appContext);
  registerGetClientRoute(fastify, appContext);
  registerUpdateClientRoute(fastify, appContext);
  registerDeleteClientRoute(fastify, appContext);
}
