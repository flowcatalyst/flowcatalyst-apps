import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../../app-context.js';
import { registerBffListPropertySetsRoute } from './list-property-sets.route.js';
import { registerBffCreatePropertySetRoute } from './create-property-set.route.js';
import { registerBffUpdatePropertySetRoute } from './update-property-set.route.js';
import { registerBffDeletePropertySetRoute } from './delete-property-set.route.js';
import { registerBffReplacePropertySetPropertiesRoute } from './replace-properties.route.js';

export function registerBffPropertySetRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffListPropertySetsRoute(fastify, appContext);
  registerBffCreatePropertySetRoute(fastify, appContext);
  registerBffUpdatePropertySetRoute(fastify, appContext);
  registerBffDeletePropertySetRoute(fastify, appContext);
  registerBffReplacePropertySetPropertiesRoute(fastify, appContext);
}
