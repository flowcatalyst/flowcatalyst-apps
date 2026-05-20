import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asClientId } from '../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../app-context.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

const LocationSummarySchema = Type.Object({
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

const ListLocationsResponseSchema = Type.Object({
  locations: Type.Array(LocationSummarySchema),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
});

const ListLocationsQuerySchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export function registerListLocationsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/locations',
    {
      schema: {
        tags: ['Locations'],
        querystring: ListLocationsQuerySchema,
        response: { 200: ListLocationsResponseSchema },
      },
    },
    async (request) => {
      const { clientId, limit = 50, offset = 0 } = request.query as {
        clientId: string;
        limit?: number;
        offset?: number;
      };
      const result = await appContext.repositories.locations.listByClient({
        clientId: asClientId(clientId),
        limit,
        offset,
      });
      return {
        locations: result.locations.map((loc) => ({
          ...loc,
          createdAt: loc.createdAt.toISOString(),
          updatedAt: loc.updatedAt.toISOString(),
        })),
        total: result.total,
        limit,
        offset,
      };
    },
  );
}
