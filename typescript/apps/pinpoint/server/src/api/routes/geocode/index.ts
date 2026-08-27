import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerAddressGeocodeRoute } from './address-geocode.route.js';
import { registerForwardGeocodeRoute } from './forward-geocode.route.js';
import { registerReverseGeocodeRoute } from './reverse-geocode.route.js';

export function registerGeocodeRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerAddressGeocodeRoute(fastify, appContext);
  registerForwardGeocodeRoute(fastify, appContext);
  registerReverseGeocodeRoute(fastify, appContext);
}
