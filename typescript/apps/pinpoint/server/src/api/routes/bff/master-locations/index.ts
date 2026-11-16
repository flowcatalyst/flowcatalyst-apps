import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListMasterLocationsRoute } from './list-master-locations.route.js';
import { registerBffGetMasterLocationRoute } from './get-master-location.route.js';
import { registerBffGetProcessingLogRoute } from './get-processing-log.route.js';
import { registerBffUpdateMasterLocationRoute } from './update-master-location.route.js';
import { registerBffDeleteMasterLocationRoute } from './delete-master-location.route.js';
import { BFF_SURFACE } from '../../../plugins/surface.js';
import { registerCompleteMasterLocationRoute } from '../../master-locations/complete-master-location.route.js';

export function registerBffMasterLocationRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffListMasterLocationsRoute(fastify, appContext);
  registerBffGetMasterLocationRoute(fastify, appContext);
  registerBffGetProcessingLogRoute(fastify, appContext);
  registerBffUpdateMasterLocationRoute(fastify, appContext);
  registerBffDeleteMasterLocationRoute(fastify, appContext);
  registerCompleteMasterLocationRoute(fastify, appContext, BFF_SURFACE);
}
