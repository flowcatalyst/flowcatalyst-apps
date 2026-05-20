import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerSpatialLookupRoute } from './spatial-lookup.route.js';

export function registerSpatialLookupRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerSpatialLookupRoute(fastify, appContext);
}
