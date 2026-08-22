import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { DeleteLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const DeleteLocationResponseSchema = Type.Object({
  locationId: Type.String(),
  deletedAt: Type.String({ format: 'date-time' }),
});

export function registerDeleteLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/clients/:clientId/locations/:locationId',
    {
      schema: {
        operationId: 'deleteLocation',
        tags: ['Locations'],
        description:
          'Delete a location. Cascades to its feature, attribute, and layer association rows.',
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          locationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: DeleteLocationResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId, locationId } = request.params as { clientId: string; locationId: string };
      const parsed = DeleteLocationCommandSchema.safeParse({ clientId, locationId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.deleteLocation.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      return reply.code(200).send({
        locationId: event.getData().locationId,
        deletedAt: event.time.toISOString(),
      });
    },
  );
}
