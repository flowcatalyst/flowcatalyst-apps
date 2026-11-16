/**
 * BFF location detail: the location with its own coordinates, geocode
 * source, source master reference, capture review and feature associations
 * (`LocationDetail`, the same shape the lifecycle actions return).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { LocationDetailRef, toLocationDetail } from '../../locations/location-detail.schema.js';

export function registerBffGetLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/locations/:locationId',
    {
      schema: {
        operationId: 'bffGetLocation',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          locationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: LocationDetailRef,
          401: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, locationId } = request.params as { clientId: string; locationId: string };
      const location = await appContext.repositories.locations.findById(asLocationId(locationId));
      if (!location || location.clientId !== clientId) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Location '${locationId}' not found.` });
      }
      const features = await appContext.repositories.layerFeatures.findFeatureAssociations(
        location.id,
      );
      return reply.code(200).send(toLocationDetail(location, features));
    },
  );
}
