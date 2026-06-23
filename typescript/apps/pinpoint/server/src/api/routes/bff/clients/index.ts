import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListClientsRoute } from './list-clients.route.js';
import { registerBffGetClientRoute } from './get-client.route.js';
import { registerBffCreateClientRoute } from './create-client.route.js';

export function registerBffClientRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerBffListClientsRoute(fastify, appContext);
  registerBffGetClientRoute(fastify, appContext);
  registerBffCreateClientRoute(fastify, appContext);
}
