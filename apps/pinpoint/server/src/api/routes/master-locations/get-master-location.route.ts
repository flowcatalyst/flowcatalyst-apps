import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asMasterLocationId } from '../../../domain/locations/ids.js';
import type { AppContext } from '../../../app-context.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const NullableDate = Type.Union([Type.String({ format: 'date-time' }), Type.Null()]);

const MasterLocationResponseSchema = Type.Object({
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
  status: Type.Union([
    Type.Literal('PENDING'),
    Type.Literal('GEOCODED'),
    Type.Literal('VALIDATED'),
    Type.Literal('REJECTED'),
  ]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  validatedAt: NullableDate,
});

const NotFoundSchema = Type.Object({
  error: Type.Literal('NotFound'),
  message: Type.String(),
});

export function registerGetMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/master-locations/:masterLocationId',
    {
      schema: {
        tags: ['MasterLocations'],
        params: Type.Object({
          clientId: Type.String(),
          masterLocationId: Type.String(),
        }),
        response: { 200: MasterLocationResponseSchema, 404: NotFoundSchema },
      },
    },
    async (request, reply) => {
      const { masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const master = await appContext.repositories.masterLocations.findById(
        asMasterLocationId(masterLocationId),
      );
      if (!master) {
        return reply.code(404).send({
          error: 'NotFound' as const,
          message: `Master location '${masterLocationId}' not found.`,
        });
      }
      return {
        ...master,
        createdAt: master.createdAt.toISOString(),
        updatedAt: master.updatedAt.toISOString(),
        validatedAt: master.validatedAt ? master.validatedAt.toISOString() : null,
      };
    },
  );
}
