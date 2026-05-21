import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListLocationsRoute } from './list-locations.route.js';
import { registerBffGetLocationRoute } from './get-location.route.js';
import { registerBffCreateLocationRoute } from './create-location.route.js';

export function registerBffLocationRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffListLocationsRoute(fastify, appContext);
  registerBffGetLocationRoute(fastify, appContext);
  registerBffCreateLocationRoute(fastify, appContext);
}
