import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdatePartitionCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const UpdatePartitionBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const UpdatePartitionResponseSchema = Type.Object({
  partitionId: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
});

export function registerUpdatePartitionRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.patch(
    '/clients/:clientId/partitions/:partitionId',
    {
      schema: {
        operationId: 'updatePartition',
        tags: ['Tenancy'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
        }),
        body: UpdatePartitionBodySchema,
        response: {
          200: UpdatePartitionResponseSchema,
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

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        partitionId: data.partitionId,
        updatedAt: event.time.toISOString(),
      });
    },
  );
}
