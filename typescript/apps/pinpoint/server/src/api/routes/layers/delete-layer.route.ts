import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { DeleteLayerCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const DeleteLayerResponseSchema = Type.Object({
  layerId: Type.String(),
  deletedAt: Type.String({ format: 'date-time' }),
});

export function registerDeleteLayerRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.delete(
    '/clients/:clientId/layers/:layerId',
    {
      schema: {
        operationId: 'deleteLayer',
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: DeleteLayerResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId, layerId } = request.params as { clientId: string; layerId: string };
      const parsed = DeleteLayerCommandSchema.safeParse({ clientId, layerId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.deleteLayer.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        layerId: data.layerId,
        deletedAt: event.time.toISOString(),
      });
    },
  );
}
