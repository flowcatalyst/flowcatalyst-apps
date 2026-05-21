import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId, asPartitionId } from '../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../app-context.js';

const ParamsSchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
});

const QuerySchema = Type.Object({
  partitionId: Type.Optional(Type.String()),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  clientId: Type.Union([Type.String(), Type.Null()]),
  partitionId: Type.Union([Type.String(), Type.Null()]),
  streetThreshold: Type.Number(),
  houseNumberThreshold: Type.Number(),
  postalCodeThreshold: Type.Number(),
  stateThreshold: Type.Number(),
  addressNameThreshold: Type.Number(),
  overallThreshold: Type.Number(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerGetMatchingConfigRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/matching-config',
    {
      schema: {
        tags: ['Matching'],
        params: ParamsSchema,
        querystring: QuerySchema,
        response: { 200: ResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { clientId } = request.params as { clientId: string };
      const { partitionId } = request.query as { partitionId?: string };

      const config = await appContext.repositories.matchingConfigs.resolve(
        asClientId(clientId),
        partitionId && partitionId.length > 0 ? asPartitionId(partitionId) : null,
      );

      return reply.code(200).send({
        id: config.id,
        clientId: config.clientId,
        partitionId: config.partitionId,
        streetThreshold: config.streetThreshold,
        houseNumberThreshold: config.houseNumberThreshold,
        postalCodeThreshold: config.postalCodeThreshold,
        stateThreshold: config.stateThreshold,
        addressNameThreshold: config.addressNameThreshold,
        overallThreshold: config.overallThreshold,
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      });
    },
  );
}
