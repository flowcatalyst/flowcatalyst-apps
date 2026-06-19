import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerForwardGeocodeRoute } from './forward-geocode.route.js';
import { registerReverseGeocodeRoute } from './reverse-geocode.route.js';

export function registerGeocodeRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerForwardGeocodeRoute(fastify, appContext);
  registerReverseGeocodeRoute(fastify, appContext);
}
