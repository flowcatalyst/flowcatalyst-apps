import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffSpatialLookupRoute } from './spatial-lookup.route.js';

export function registerBffSpatialLookupRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffSpatialLookupRoute(fastify, appContext);
}
