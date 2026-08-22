/**
 * PUT /bff/clients/:clientId/layers/:layerId/partitions
 * Replace the partitions a layer is visible to via the set-layer-partitions
 * use case (emits `pinpoint:layers:layer:partitions-set`).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { SetLayerPartitionsCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const BodySchema = Type.Object({
  partitionIds: Type.Array(Type.String({ minLength: 1 })),
});
const ResponseSchema = Type.Object({
  partitionIds: Type.Array(Type.String()),
});

export function registerBffSetLayerPartitionsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/layers/:layerId/partitions',
    {
      schema: {
        operationId: 'bffSetLayerPartitions',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
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
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const params = request.params as { clientId: string; layerId: string };
      const { partitionIds } = request.body as { partitionIds: readonly string[] };
      const parsed = SetLayerPartitionsCommandSchema.safeParse({ ...params, partitionIds });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.setLayerPartitions.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);

      return reply.code(200).send({ partitionIds: [...result.value.getData().partitionIds] });
    },
  );
}
