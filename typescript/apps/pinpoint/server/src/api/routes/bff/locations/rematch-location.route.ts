/**
 * BFF location rematch. The SPA's location detail page posts an edited
 * `matchAddress`; this re-runs matching via the `rematch-location` use case and
 * returns the new master link + status so the UI can refresh.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { RematchLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

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

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
});

export function registerBffRematchLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/locations/:locationId/rematch',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          locationId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId, locationId } = request.params as { clientId: string; locationId: string };
      const { matchAddress } = request.body as { matchAddress: string };
      const parsed = RematchLocationCommandSchema.safeParse({ clientId, locationId, matchAddress });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError' });
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
