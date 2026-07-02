import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { RematchLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

const BodySchema = Type.Object({
  matchAddress: Type.String({ minLength: 1 }),
});

const ResponseSchema = Type.Object({
  locationId: Type.String(),
  masterLocationId: Type.String(),
  previousMasterLocationId: Type.Union([Type.String(), Type.Null()]),
  previousMasterDeleted: Type.Boolean(),
  status: Type.String(),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerRematchLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/clients/:clientId/locations/:locationId/rematch',
    {
      schema: {
        tags: ['Locations'],
        description:
          'Set a location\'s match address and re-run matching. Re-points it to a matched validated master or a fresh PENDING master; the previous auto-created PENDING master is deleted when nothing else links to it.',
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          locationId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId, locationId } = request.params as { clientId: string; locationId: string };
      const { matchAddress } = request.body as { matchAddress: string };
      const parsed = RematchLocationCommandSchema.safeParse({ clientId, locationId, matchAddress });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.rematchLocation.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const data = result.value.getData();
      return reply.code(200).send({
        locationId: data.locationId,
        masterLocationId: data.masterLocationId,
        previousMasterLocationId: data.previousMasterLocationId,
        previousMasterDeleted: data.previousMasterDeleted,
        status: data.status,
      });
    },
  );
}
