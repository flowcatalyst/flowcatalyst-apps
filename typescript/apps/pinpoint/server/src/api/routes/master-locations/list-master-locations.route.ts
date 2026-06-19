import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asClientId } from '../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../app-context.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const NullableDate = Type.Union([Type.String({ format: 'date-time' }), Type.Null()]);

const MasterLocationSummarySchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  partitionId: NullableString,
  normalizedHouseNumber: NullableString,
  normalizedRoad: NullableString,
  normalizedSuburb: NullableString,
  normalizedCity: Type.String(),
  normalizedState: NullableString,
  normalizedPostalCode: NullableString,
  normalizedCountry: Type.String(),
  addressHash: Type.String(),
  normalizedAddressLine: NullableString,
  latitude: NullableNumber,
  longitude: NullableNumber,
  status: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  validatedAt: NullableDate,
});

const ListResponseSchema = Type.Object({
  masters: Type.Array(MasterLocationSummarySchema),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
});

const ListQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export function registerListMasterLocationsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/master-locations',
    {
      schema: {
        tags: ['MasterLocations'],
        params: Type.Object({ clientId: Type.String() }),
        querystring: ListQuerySchema,
        response: { 200: ListResponseSchema },
      },
    },
    async (request) => {
      const { clientId } = request.params as { clientId: string };
      const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number };
      const result = await appContext.repositories.masterLocations.listByClient({
        clientId: asClientId(clientId),
        limit,
        offset,
      });
      return {
        masters: result.masters.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
          validatedAt: m.validatedAt ? m.validatedAt.toISOString() : null,
        })),
        total: result.total,
        limit,
        offset,
      };
    },
  );
}
