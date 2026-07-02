/**
 * BFF location delete. Delegates to `delete-location` via runWrite. The
 * location's feature/attribute/layer association rows cascade on FK.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { DeleteLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

const ResponseSchema = Type.Object({ success: Type.Literal(true) });

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
});

export function registerBffDeleteLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/bff/clients/:clientId/locations/:locationId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          locationId: Type.String({ minLength: 1 }),
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
      const { clientId, locationId } = request.params as { clientId: string; locationId: string };
      const parsed = DeleteLocationCommandSchema.safeParse({ clientId, locationId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError' });
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
      return reply.code(200).send({ success: true });
    },
  );
}
