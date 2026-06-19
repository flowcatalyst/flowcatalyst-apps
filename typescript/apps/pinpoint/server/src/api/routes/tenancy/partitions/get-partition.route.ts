import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asPartitionId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';

const PartitionResponseSchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const NotFoundSchema = Type.Object({
  error: Type.Literal('NotFound'),
  message: Type.String(),
});

export function registerGetPartitionRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/clients/:clientId/partitions/:partitionId',
    {
      schema: {
        tags: ['Tenancy'],
        params: Type.Object({
          clientId: Type.String(),
          partitionId: Type.String(),
        }),
        response: { 200: PartitionResponseSchema, 404: NotFoundSchema },
      },
    },
    async (request, reply) => {
      const { partitionId } = request.params as { clientId: string; partitionId: string };
      const partition = await appContext.repositories.partitions.findById(
        asPartitionId(partitionId),
      );
      if (!partition) {
        return reply.code(404).send({
          error: 'NotFound' as const,
          message: `Partition '${partitionId}' not found.`,
        });
      }
      return {
        id: partition.id,
        clientId: partition.clientId,
        code: partition.code,
        name: partition.name,
        description: partition.description,
        createdAt: partition.createdAt.toISOString(),
        updatedAt: partition.updatedAt.toISOString(),
      };
    },
  );
}
