/**
 * POST /master-locations/:id/confirm — mark a GEOCODED master_location
 * as VALIDATED. Cascades LocationValidated to every non-validated child
 * `locations` row + writes per-child `location_feature_associations`
 * from the master's coordinate.
 */
import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { ConfirmMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

const ConfirmBodySchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
});

const ConfirmResponseSchema = Type.Object({
  masterLocationId: Type.String(),
  locationsValidated: Type.Integer({ minimum: 0 }),
  featuresMatched: Type.Integer({ minimum: 0 }),
  validatedAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerConfirmMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/master-locations/:id/confirm',
    {
      schema: {
        tags: ['MasterLocations'],
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        body: ConfirmBodySchema,
        response: {
          200: ConfirmResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ConfirmMasterLocationCommandSchema.safeParse({
        ...(request.body as object),
        masterLocationId: id,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.confirmMasterLocation.execute(parsed.data),
        scope,
      );
      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(200).send({
        masterLocationId: data.masterLocationId,
        locationsValidated: data.locationsValidated,
        featuresMatched: data.featuresMatched,
        validatedAt: event.time.toISOString(),
      });
    },
  );
}
