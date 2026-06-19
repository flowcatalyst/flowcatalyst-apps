import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerMeRoute } from './me.route.js';
import { registerLoginRoute } from './login.route.js';
import { registerCallbackRoute } from './callback.route.js';
import { registerLogoutRoute } from './logout.route.js';

export function registerAuthRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerMeRoute(fastify, appContext);
  registerLoginRoute(fastify, appContext);
  registerCallbackRoute(fastify, appContext);
  registerLogoutRoute(fastify, appContext);
}
