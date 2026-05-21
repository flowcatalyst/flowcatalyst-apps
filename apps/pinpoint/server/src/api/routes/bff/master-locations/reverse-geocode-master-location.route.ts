/**
 * BFF master-location reverse-geocode. Mirror of Rust
 * `routes/bff/master_locations.rs::reverse_geocode`.
 *
 * Reverse-geocodes the master's current coordinates and returns
 * suggested address components — does NOT mutate. The SPA shows the
 * suggestion to the user; on confirmation, the SPA orchestrates the
 * apply via `PUT /master-locations/:id` followed by `POST .../validate`.
 *
 * (The Rust BFF also exposes a one-shot `/confirm-geocode` endpoint
 * that bundles the apply + validate. That's deferred to a follow-up;
 * the SPA can already achieve the same outcome via two existing calls.)
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asMasterLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';

const ResponseSchema = Type.Object({
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

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
});

export function registerBffReverseGeocodeMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/master-locations/:masterLocationId/reverse-geocode',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
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

      const { masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const ml = await appContext.repositories.masterLocations.findById(
        asMasterLocationId(masterLocationId),
      );
      if (!ml) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Master location '${masterLocationId}' not found.`,
        });
      }
      if (ml.latitude == null || ml.longitude == null) {
        return reply.code(409).send({
          error: 'BusinessRuleViolation',
          code: 'NO_COORDINATES',
          message: 'Master location has no coordinates to reverse geocode.',
        });
      }

      try {
        const result = await appContext.services.geocoder.reverseGeocode(
          ml.latitude,
          ml.longitude,
        );
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
        return reply.code(502).send({ error: 'BadGateway', message });
      }
    },
  );
}
