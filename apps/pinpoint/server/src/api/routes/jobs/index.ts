import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import {
  registerValidateMasterLocationsRoute,
  type RegisterValidateMasterLocationsRouteOptions,
} from './validate-master-locations.route.js';

export type { RegisterValidateMasterLocationsRouteOptions };

export function registerJobsRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterValidateMasterLocationsRouteOptions,
): void {
  registerValidateMasterLocationsRoute(fastify, appContext, options);
}
