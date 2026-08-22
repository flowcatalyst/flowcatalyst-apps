import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { DeleteClientCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const DeleteClientResponseSchema = Type.Object({
  clientId: Type.String(),
  deletedAt: Type.String({ format: 'date-time' }),
});

export function registerDeleteClientRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.delete(
    '/clients/:clientId',
    {
      schema: {
        operationId: 'deleteClient',
        tags: ['Tenancy'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        response: {
          200: DeleteClientResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const parsed = DeleteClientCommandSchema.safeParse({ clientId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.deleteClient.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        clientId: data.clientId,
        deletedAt: event.time.toISOString(),
      });
    },
  );
}
