import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerCreateLayerRoute } from './create-layer.route.js';
import { registerGetLayerRoute } from './get-layer.route.js';
import { registerListLayersRoute } from './list-layers.route.js';

export function registerLayerRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerCreateLayerRoute(fastify, appContext);
  registerGetLayerRoute(fastify, appContext);
  registerListLayersRoute(fastify, appContext);
}
