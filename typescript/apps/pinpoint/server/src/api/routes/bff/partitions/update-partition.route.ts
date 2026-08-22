/**
 * BFF partition update. Mirror of Rust `routes/bff/partitions.rs::update_partition`.
 * Delegates to `update-partition` via `runWrite`, then re-reads to return
 * the full partition detail (matches Rust's response shape).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdatePartitionCommandSchema } from '@pinpoint/shared';
import { asPartitionId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const BodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export function registerBffUpdatePartitionRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/partitions/:partitionId',
    {
      schema: {
        operationId: 'bffUpdatePartition',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId, partitionId } = request.params as {
        clientId: string;
        partitionId: string;
      };
      const parsed = UpdatePartitionCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
        partitionId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.updatePartition.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const partition = await appContext.repositories.partitions.findById(
        asPartitionId(partitionId),
      );
      if (!partition) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Partition '${partitionId}' not found after update.`,
        });
      }

      return reply.code(200).send({
        id: partition.id,
        code: partition.code,
        name: partition.name,
        description: partition.description,
        createdAt: partition.createdAt.toISOString(),
        updatedAt: partition.updatedAt.toISOString(),
      });
    },
  );
}
