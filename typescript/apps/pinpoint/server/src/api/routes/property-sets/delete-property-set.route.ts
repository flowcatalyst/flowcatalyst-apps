import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { DeletePropertySetCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const DeletePropertySetResponseSchema = Type.Object({
  propertySetId: Type.String(),
  deletedAt: Type.String({ format: 'date-time' }),
});

export function registerDeletePropertySetRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/clients/:clientId/layers/:layerId/property-sets/:propertySetId',
    {
      schema: {
        operationId: 'deletePropertySet',
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          propertySetId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: DeletePropertySetResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId, layerId, propertySetId } = request.params as {
        clientId: string;
        layerId: string;
        propertySetId: string;
      };
      const parsed = DeletePropertySetCommandSchema.safeParse({
        clientId,
        layerId,
        propertySetId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.deletePropertySet.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        propertySetId: data.propertySetId,
        deletedAt: event.time.toISOString(),
      });
    },
  );
}
