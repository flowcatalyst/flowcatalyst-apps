import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerValidateMasterLocationRoute } from './validate-master-location.route.js';
import { registerConfirmMasterLocationRoute } from './confirm-master-location.route.js';
import { registerGetMasterLocationRoute } from './get-master-location.route.js';
import { registerListMasterLocationsRoute } from './list-master-locations.route.js';

export function registerMasterLocationRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerValidateMasterLocationRoute(fastify, appContext);
  registerConfirmMasterLocationRoute(fastify, appContext);
  registerGetMasterLocationRoute(fastify, appContext);
  registerListMasterLocationsRoute(fastify, appContext);
}
