import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdatePartitionCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

const UpdatePartitionBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const UpdatePartitionResponseSchema = Type.Object({
  partitionId: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerUpdatePartitionRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.patch(
    '/clients/:clientId/partitions/:partitionId',
    {
      schema: {
        tags: ['Tenancy'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
        }),
        body: UpdatePartitionBodySchema,
        response: {
          200: UpdatePartitionResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
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

      const result = await appContext.runWrite(
        appContext.useCases.updatePartition.execute(parsed.data),
        scope,
      );

      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(200).send({
        partitionId: data.partitionId,
        updatedAt: event.time.toISOString(),
      });
    },
  );
}
