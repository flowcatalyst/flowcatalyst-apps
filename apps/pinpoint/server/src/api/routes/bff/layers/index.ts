import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListLayersRoute } from './list-layers.route.js';
import { registerBffGetLayerRoute } from './get-layer.route.js';
import { registerBffCreateLayerRoute } from './create-layer.route.js';
import { registerBffUpdateLayerRoute } from './update-layer.route.js';
import { registerBffDeleteLayerRoute } from './delete-layer.route.js';
import { registerBffSetLayerPartitionsRoute } from './set-layer-partitions.route.js';
import { registerBffPropertySetRoutes } from './property-sets/index.js';

export function registerBffLayerRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffListLayersRoute(fastify, appContext);
  registerBffGetLayerRoute(fastify, appContext);
  registerBffCreateLayerRoute(fastify, appContext);
  registerBffUpdateLayerRoute(fastify, appContext);
  registerBffDeleteLayerRoute(fastify, appContext);
  registerBffSetLayerPartitionsRoute(fastify, appContext);
  registerBffPropertySetRoutes(fastify, appContext);
}
