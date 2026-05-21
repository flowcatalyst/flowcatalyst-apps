import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerCreatePropertySetRoute } from './create-property-set.route.js';
import { registerDeletePropertySetRoute } from './delete-property-set.route.js';
import { registerListPropertySetsRoute } from './list-property-sets.route.js';
import { registerReplacePropertySetPropertiesRoute } from './replace-property-set-properties.route.js';
import { registerUpdatePropertySetRoute } from './update-property-set.route.js';

export function registerPropertySetRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerListPropertySetsRoute(fastify, appContext);
  registerCreatePropertySetRoute(fastify, appContext);
  registerUpdatePropertySetRoute(fastify, appContext);
  registerDeletePropertySetRoute(fastify, appContext);
  registerReplacePropertySetPropertiesRoute(fastify, appContext);
}
