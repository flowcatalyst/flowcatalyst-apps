import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerCreateLocationRoute } from './create-location.route.js';
import { registerGetLocationRoute } from './get-location.route.js';
import { registerListLocationsRoute } from './list-locations.route.js';

export function registerLocationRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerCreateLocationRoute(fastify, appContext);
  registerGetLocationRoute(fastify, appContext);
  registerListLocationsRoute(fastify, appContext);
}
