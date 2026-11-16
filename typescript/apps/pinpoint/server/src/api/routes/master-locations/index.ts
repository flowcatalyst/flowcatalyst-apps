import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { CANONICAL_SURFACE } from '../../plugins/surface.js';
import { registerCompleteMasterLocationRoute } from './complete-master-location.route.js';
import { registerGetMasterLocationRoute } from './get-master-location.route.js';
import { registerListMasterLocationsRoute } from './list-master-locations.route.js';
import { registerRejectMasterLocationRoute } from './reject-master-location.route.js';
import { registerUpdateMasterLocationRoute } from './update-master-location.route.js';
import { registerUnvalidatedMasterLocationsRoute } from './unvalidated.route.js';
import { registerDeleteMasterLocationRoute } from './delete-master-location.route.js';

export function registerMasterLocationRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerCompleteMasterLocationRoute(fastify, appContext, CANONICAL_SURFACE);
  registerGetMasterLocationRoute(fastify, appContext);
  registerListMasterLocationsRoute(fastify, appContext);
  registerUpdateMasterLocationRoute(fastify, appContext);
  registerRejectMasterLocationRoute(fastify, appContext);
  registerUnvalidatedMasterLocationsRoute(fastify, appContext);
  registerDeleteMasterLocationRoute(fastify, appContext);
}
