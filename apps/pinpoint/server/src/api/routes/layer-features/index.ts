import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerCreateLayerFeatureRoute } from './create-layer-feature.route.js';
import { registerUpdateLayerFeatureRoute } from './update-layer-feature.route.js';
import { registerDeleteLayerFeatureRoute } from './delete-layer-feature.route.js';
import { registerGetLayerFeatureRoute } from './get-layer-feature.route.js';
import { registerListLayerFeaturesRoute } from './list-layer-features.route.js';

export function registerLayerFeatureRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerCreateLayerFeatureRoute(fastify, appContext);
  registerUpdateLayerFeatureRoute(fastify, appContext);
  registerDeleteLayerFeatureRoute(fastify, appContext);
  registerGetLayerFeatureRoute(fastify, appContext);
  registerListLayerFeaturesRoute(fastify, appContext);
}
