import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const DeleteLayerFeatureResponseSchema = Type.Object({
  featureId: Type.String(),
  deletedAt: Type.String({ format: 'date-time' }),
});

export function registerDeleteLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/clients/:clientId/layers/:layerId/features/:featureId',
    {
      schema: {
        operationId: 'deleteLayerFeature',
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          featureId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: DeleteLayerFeatureResponseSchema,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { featureId } = request.params as {
        clientId: string;
        layerId: string;
        featureId: string;
      };

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.deleteLayerFeature.execute({ featureId }),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        featureId: data.featureId,
        deletedAt: event.time.toISOString(),
      });
    },
  );
}
