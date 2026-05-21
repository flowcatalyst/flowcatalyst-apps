import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerCreateLayerRoute } from './create-layer.route.js';
import { registerDeleteLayerRoute } from './delete-layer.route.js';
import { registerGetLayerRoute } from './get-layer.route.js';
import { registerListLayersRoute } from './list-layers.route.js';
import { registerUpdateLayerRoute } from './update-layer.route.js';

export function registerLayerRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerCreateLayerRoute(fastify, appContext);
  registerListLayersRoute(fastify, appContext);
  registerGetLayerRoute(fastify, appContext);
  registerUpdateLayerRoute(fastify, appContext);
  registerDeleteLayerRoute(fastify, appContext);
}
