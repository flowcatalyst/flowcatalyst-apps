import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListMasterLocationsRoute } from './list-master-locations.route.js';
import { registerBffGetMasterLocationRoute } from './get-master-location.route.js';
import { registerBffGetProcessingLogRoute } from './get-processing-log.route.js';
import { registerBffUpdateMasterLocationRoute } from './update-master-location.route.js';
import { registerBffValidateMasterLocationRoute } from './validate-master-location.route.js';
import { registerBffGeocodeMasterLocationRoute } from './geocode-master-location.route.js';
import { registerBffReverseGeocodeMasterLocationRoute } from './reverse-geocode-master-location.route.js';
import { registerBffConfirmGeocodeRoute } from './confirm-geocode.route.js';
import { registerBffMatchFeaturesRoutes } from './match-features.route.js';
import { registerBffDeleteMasterLocationRoute } from './delete-master-location.route.js';

export function registerBffMasterLocationRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffListMasterLocationsRoute(fastify, appContext);
  registerBffGetMasterLocationRoute(fastify, appContext);
  registerBffGetProcessingLogRoute(fastify, appContext);
  registerBffUpdateMasterLocationRoute(fastify, appContext);
  registerBffValidateMasterLocationRoute(fastify, appContext);
  registerBffGeocodeMasterLocationRoute(fastify, appContext);
  registerBffReverseGeocodeMasterLocationRoute(fastify, appContext);
  registerBffConfirmGeocodeRoute(fastify, appContext);
  registerBffMatchFeaturesRoutes(fastify, appContext);
  registerBffDeleteMasterLocationRoute(fastify, appContext);
}
