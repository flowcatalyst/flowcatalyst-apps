import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { DeleteMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const DeleteMasterLocationResponseSchema = Type.Object({
  masterLocationId: Type.String(),
  locationsDeleted: Type.Integer({ minimum: 0 }),
  deletedAt: Type.String({ format: 'date-time' }),
});

export function registerDeleteMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/clients/:clientId/master-locations/:masterLocationId',
    {
      schema: {
        operationId: 'deleteMasterLocation',
        tags: ['Master Locations'],
        description:
          "Delete a master location. CASCADE: also deletes every child location linked to it (each cascading its own association rows) and the master location's processing-log rows.",
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: DeleteMasterLocationResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId, masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const parsed = DeleteMasterLocationCommandSchema.safeParse({ clientId, masterLocationId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.deleteMasterLocation.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        masterLocationId: data.masterLocationId,
        locationsDeleted: data.locationsDeleted,
        deletedAt: event.time.toISOString(),
      });
    },
  );
}
