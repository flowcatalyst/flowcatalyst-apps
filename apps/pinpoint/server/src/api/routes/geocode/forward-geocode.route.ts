/**
 * POST /geocode/forward — forward geocode a structured normalized
 * address into coordinates.
 *
 * The Rust pinpoint does not expose forward geocoding via API (it's
 * only called internally by the matching pipeline). Pinpoint TS adds
 * it as a Slice 6 affordance so the integration can be exercised
 * end-to-end before the master-locations slice wires it into
 * create-location.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';
import type { NormalizedAddress } from '../../../domain/services/address-normalizer.js';

const ForwardGeocodeBodySchema = Type.Object({
  houseNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  road: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  suburb: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  city: Type.String({ minLength: 1 }),
  state: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  postalCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  country: Type.String({ minLength: 1 }),
});

const ForwardGeocodeResponseSchema = Type.Object({
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number(),
  formattedAddress: Type.Union([Type.String(), Type.Null()]),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerForwardGeocodeRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/geocode/forward',
    {
      schema: {
        tags: ['Geocode'],
        body: ForwardGeocodeBodySchema,
        response: {
          200: ForwardGeocodeResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
          502: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const body = request.body as {
        houseNumber?: string | null;
        road?: string | null;
        suburb?: string | null;
        city: string;
        state?: string | null;
        postalCode?: string | null;
        country: string;
      };
      const address: NormalizedAddress = {
        houseNumber: body.houseNumber ?? null,
        road: body.road ?? null,
        suburb: body.suburb ?? null,
        city: body.city,
        state: body.state ?? null,
        postalCode: body.postalCode ?? null,
        country: body.country,
      };

      try {
        const result = await appContext.services.geocoder.geocode(address);
        return reply.code(200).send({
          latitude: result.latitude,
          longitude: result.longitude,
          confidence: result.confidence,
          formattedAddress: result.formattedAddress,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith('No geocoding results') ? 404 : 502;
        return reply.code(status).send({
          error: status === 404 ? 'NotFound' : 'BadGateway',
          message,
        });
      }
    },
  );
}
