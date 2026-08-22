import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId, asPartitionId } from '../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../app-context.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';
import { MatchingConfigRef } from './matching-config.schema.js';

const ParamsSchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
});

const QuerySchema = Type.Object({
  partitionId: Type.Optional(Type.String()),
});

const ResponseSchema = MatchingConfigRef;

export function registerGetMatchingConfigRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/matching-config',
    {
      schema: {
        operationId: 'getMatchingConfig',
        tags: ['Matching'],
        params: ParamsSchema,
        querystring: QuerySchema,
        response: { 200: ResponseSchema, 401: ErrorResponseRef, 500: ErrorResponseRef },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
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
