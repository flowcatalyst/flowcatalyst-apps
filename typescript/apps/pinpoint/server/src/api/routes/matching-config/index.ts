import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerGetMatchingConfigRoute } from './get-matching-config.route.js';
import { registerUpdateMatchingConfigRoute } from './update-matching-config.route.js';

export function registerMatchingConfigRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerGetMatchingConfigRoute(fastify, appContext);
  registerUpdateMatchingConfigRoute(fastify, appContext);
}
