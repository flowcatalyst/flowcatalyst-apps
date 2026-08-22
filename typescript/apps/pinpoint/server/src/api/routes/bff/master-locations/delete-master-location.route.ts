/**
 * BFF master-location delete. Delegates to `delete-master-location` via
 * runWrite. CASCADE: also deletes the master's child locations (each cascading
 * its association rows) and its processing-log rows. Returns the count of child
 * locations removed so the UI can confirm the blast radius.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { DeleteMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const ResponseSchema = Type.Object({
  success: Type.Literal(true),
  locationsDeleted: Type.Integer({ minimum: 0 }),
});

export function registerBffDeleteMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/bff/clients/:clientId/master-locations/:masterLocationId',
    {
      schema: {
        operationId: 'bffDeleteMasterLocation',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          409: ErrorResponseRef,
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
        return reply.code(400).send({ error: 'ValidationError' });
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
      return reply.code(200).send({
        success: true,
        locationsDeleted: result.value.getData().locationsDeleted,
      });
    },
  );
}
