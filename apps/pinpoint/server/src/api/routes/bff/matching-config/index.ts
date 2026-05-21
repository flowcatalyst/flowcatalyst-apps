import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffGetMatchingConfigRoute } from './get-matching-config.route.js';
import { registerBffUpdateMatchingConfigRoute } from './update-matching-config.route.js';

export function registerBffMatchingConfigRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffGetMatchingConfigRoute(fastify, appContext);
  registerBffUpdateMatchingConfigRoute(fastify, appContext);
}
