import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerCreateLocationRoute } from './create-location.route.js';
import { registerGetLocationRoute } from './get-location.route.js';
import { registerListLocationsRoute } from './list-locations.route.js';
import { registerDeleteLocationRoute } from './delete-location.route.js';
import { registerRematchLocationRoute } from './rematch-location.route.js';
import { CANONICAL_SURFACE } from '../../plugins/surface.js';
import { registerLocationLifecycleRoutes } from './lifecycle.routes.js';
import { registerCaptureLocationCoordinatesRoute } from './capture-location-coordinates.route.js';

export function registerLocationRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerCreateLocationRoute(fastify, appContext);
  registerGetLocationRoute(fastify, appContext);
  registerListLocationsRoute(fastify, appContext);
  registerDeleteLocationRoute(fastify, appContext);
  registerRematchLocationRoute(fastify, appContext);
  registerLocationLifecycleRoutes(fastify, appContext, CANONICAL_SURFACE);
  registerCaptureLocationCoordinatesRoute(fastify, appContext, CANONICAL_SURFACE);
}
