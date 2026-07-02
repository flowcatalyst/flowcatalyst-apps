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

const ResponseSchema = Type.Object({
  success: Type.Literal(true),
  locationsDeleted: Type.Integer({ minimum: 0 }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
});

export function registerBffDeleteMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/bff/clients/:clientId/master-locations/:masterLocationId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
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
