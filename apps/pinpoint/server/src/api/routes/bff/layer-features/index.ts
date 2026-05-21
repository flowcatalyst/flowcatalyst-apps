import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListLayerFeaturesRoute } from './list-features.route.js';
import { registerBffGetLayerFeatureRoute } from './get-feature.route.js';
import { registerBffCreateLayerFeatureRoute } from './create-feature.route.js';
import { registerBffUpdateLayerFeatureRoute } from './update-feature.route.js';
import { registerBffDeleteLayerFeatureRoute } from './delete-feature.route.js';
import { registerBffSetFeatureStatusRoute } from './set-feature-status.route.js';

export function registerBffLayerFeatureRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffListLayerFeaturesRoute(fastify, appContext);
  registerBffGetLayerFeatureRoute(fastify, appContext);
  registerBffCreateLayerFeatureRoute(fastify, appContext);
  registerBffUpdateLayerFeatureRoute(fastify, appContext);
  registerBffDeleteLayerFeatureRoute(fastify, appContext);
  registerBffSetFeatureStatusRoute(fastify, appContext);
}
