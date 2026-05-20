import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerCreateClientRoute } from './create-client.route.js';
import { registerGetClientRoute } from './get-client.route.js';

export function registerClientRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerCreateClientRoute(fastify, appContext);
  registerGetClientRoute(fastify, appContext);
}
