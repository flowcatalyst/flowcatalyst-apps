/**
 * POST /geocode/reverse — turn coordinates into a structured address.
 * Mirror of Rust `routes/geocode_routes.rs::reverse_geocode`.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, UseCaseError } from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const ReverseGeocodeBodySchema = Type.Object({
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
});

const ReverseGeocodeResponseSchema = Type.Object({
  houseNumber: Type.Union([Type.String(), Type.Null()]),
  road: Type.Union([Type.String(), Type.Null()]),
  suburb: Type.Union([Type.String(), Type.Null()]),
  city: Type.String(),
  state: Type.Union([Type.String(), Type.Null()]),
  postalCode: Type.Union([Type.String(), Type.Null()]),
  country: Type.String(),
  formattedAddress: Type.String(),
  confidence: Type.Number(),
});

export function registerReverseGeocodeRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/geocode/reverse',
    {
      schema: {
        operationId: 'reverseGeocode',
        tags: ['Geocode'],
        body: ReverseGeocodeBodySchema,
        response: {
          200: ReverseGeocodeResponseSchema,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
          502: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      if (!scope.permissions.has(PinpointPermission.MatchingSpatialLookup)) {
        return sendUseCaseError(
          reply,
          UseCaseError.authorization(
            'PERMISSION_DENIED',
            `Missing permission ${PinpointPermission.MatchingSpatialLookup}.`,
          ),
        );
      }

      const { latitude, longitude } = request.body as { latitude: number; longitude: number };

      try {
        const result = await appContext.services.geocoder.reverseGeocode(latitude, longitude);
        return reply.code(200).send({
          houseNumber: result.address.houseNumber,
          road: result.address.road,
          suburb: result.address.suburb,
          city: result.address.city,
          state: result.address.state,
          postalCode: result.address.postalCode,
          country: result.address.country,
          formattedAddress: result.formattedAddress,
          confidence: result.confidence,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith('No reverse geocoding results') ? 404 : 502;
        return reply.code(status).send({
          error: status === 404 ? 'NotFound' : 'BadGateway',
          message,
        });
      }
    },
  );
}
