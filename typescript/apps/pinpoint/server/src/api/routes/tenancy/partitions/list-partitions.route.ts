import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';

const PartitionSummarySchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ListPartitionsResponseSchema = Type.Object({
  partitions: Type.Array(PartitionSummarySchema),
});

export function registerListPartitionsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/partitions',
    {
      schema: {
        tags: ['Tenancy'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        response: { 200: ListPartitionsResponseSchema },
      },
    },
    async (request) => {
      const { clientId } = request.params as { clientId: string };
      const partitions = await appContext.repositories.partitions.listByClient(
        asClientId(clientId),
      );
      return {
        partitions: partitions.map((partition) => ({
          id: partition.id,
          clientId: partition.clientId,
          code: partition.code,
          name: partition.name,
          description: partition.description,
          createdAt: partition.createdAt.toISOString(),
          updatedAt: partition.updatedAt.toISOString(),
        })),
      };
    },
  );
}
