import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

const UpdateMasterLocationBodySchema = Type.Object({
  normalizedHouseNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  normalizedRoad: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  normalizedSuburb: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  normalizedCity: Type.String({ minLength: 1 }),
  normalizedState: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  normalizedPostalCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  normalizedCountry: Type.String({ minLength: 1 }),
});

const UpdateMasterLocationResponseSchema = Type.Object({
  masterLocationId: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerUpdateMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.patch(
    '/clients/:clientId/master-locations/:masterLocationId',
    {
      schema: {
        tags: ['MasterLocations'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        body: UpdateMasterLocationBodySchema,
        response: {
          200: UpdateMasterLocationResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId, masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const parsed = UpdateMasterLocationCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
        masterLocationId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.updateMasterLocation.execute(parsed.data),
        scope,
      );

      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(200).send({
        masterLocationId: data.masterLocationId,
        updatedAt: event.time.toISOString(),
      });
    },
  );
}
