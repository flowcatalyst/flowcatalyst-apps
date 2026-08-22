import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

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

export function registerUpdateMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.patch(
    '/clients/:clientId/master-locations/:masterLocationId',
    {
      schema: {
        operationId: 'updateMasterLocation',
        tags: ['MasterLocations'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        body: UpdateMasterLocationBodySchema,
        response: {
          200: UpdateMasterLocationResponseSchema,
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

      const result = await appContext.runWrite(() =>
        appContext.useCases.updateMasterLocation.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        masterLocationId: data.masterLocationId,
        updatedAt: event.time.toISOString(),
      });
    },
  );
}
