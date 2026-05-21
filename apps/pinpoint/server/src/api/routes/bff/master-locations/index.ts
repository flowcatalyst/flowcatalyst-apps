import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListMasterLocationsRoute } from './list-master-locations.route.js';
import { registerBffGetMasterLocationRoute } from './get-master-location.route.js';
import { registerBffGetProcessingLogRoute } from './get-processing-log.route.js';
import { registerBffUpdateMasterLocationRoute } from './update-master-location.route.js';
import { registerBffValidateMasterLocationRoute } from './validate-master-location.route.js';
import { registerBffGeocodeMasterLocationRoute } from './geocode-master-location.route.js';
import { registerBffReverseGeocodeMasterLocationRoute } from './reverse-geocode-master-location.route.js';

/**
 * BFF master-location routes. Deferred from this commit:
 *  - POST /:id/confirm-geocode  (compound apply-coords + validate; SPA
 *    can orchestrate via PUT + POST /validate)
 *  - POST /:id/match-features   (single-master spatial re-match)
 *  - POST /match-features       (client-wide bulk re-match)
 * Tracked in HANDOFF as a follow-up; the matching pipeline already
 * runs spatial-lookup automatically on the canonical VALIDATED
 * transition, so these are operator-tool repairs rather than primary
 * flows.
 */
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
}
