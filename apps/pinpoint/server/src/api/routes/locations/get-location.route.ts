import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asLocationId } from '../../../domain/locations/ids.js';
import type { AppContext } from '../../../app-context.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

const LocationResponseSchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  partitionId: NullableString,
  masterLocationId: NullableString,
  externalId: NullableString,
  name: NullableString,
  rawAddressLine1: Type.String(),
  rawAddressLine2: NullableString,
  rawSuburb: NullableString,
  rawCity: Type.String(),
  rawState: NullableString,
  rawPostalCode: NullableString,
  rawCountry: Type.String(),
  normalizedHouseNumber: NullableString,
  normalizedRoad: NullableString,
  normalizedSuburb: NullableString,
  normalizedCity: NullableString,
  normalizedState: NullableString,
  normalizedPostalCode: NullableString,
  normalizedCountry: NullableString,
  addressHash: NullableString,
  matchConfidence: NullableNumber,
  matchMethod: NullableString,
  status: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const NotFoundSchema = Type.Object({
  error: Type.Literal('NotFound'),
  message: Type.String(),
});

export function registerGetLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/locations/:locationId',
    {
      schema: {
        tags: ['Locations'],
        params: Type.Object({
          clientId: Type.String(),
          locationId: Type.String(),
        }),
        response: { 200: LocationResponseSchema, 404: NotFoundSchema },
      },
    },
    async (request, reply) => {
      const { locationId } = request.params as { clientId: string; locationId: string };
      const loc = await appContext.repositories.locations.findById(asLocationId(locationId));
      if (!loc) {
        return reply
          .code(404)
          .send({ error: 'NotFound' as const, message: `Location '${locationId}' not found.` });
      }
      return {
        ...loc,
        createdAt: loc.createdAt.toISOString(),
        updatedAt: loc.updatedAt.toISOString(),
      };
    },
  );
}
