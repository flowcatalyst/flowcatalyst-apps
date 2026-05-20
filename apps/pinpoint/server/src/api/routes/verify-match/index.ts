import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerVerifyMatchRoute } from './verify-match.route.js';

export function registerVerifyMatchRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerVerifyMatchRoute(fastify, appContext);
}
