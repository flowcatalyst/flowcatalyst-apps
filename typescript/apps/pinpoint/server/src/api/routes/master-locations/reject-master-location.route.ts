import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { RejectMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const RejectMasterLocationBodySchema = Type.Object({
  reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const RejectMasterLocationResponseSchema = Type.Object({
  masterLocationId: Type.String(),
  rejectedAt: Type.String({ format: 'date-time' }),
});

export function registerRejectMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/clients/:clientId/master-locations/:masterLocationId/reject',
    {
      schema: {
        operationId: 'rejectMasterLocation',
        tags: ['MasterLocations'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        body: RejectMasterLocationBodySchema,
        response: {
          200: RejectMasterLocationResponseSchema,
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
      const body = (request.body ?? {}) as { reason?: string | null };
      const parsed = RejectMasterLocationCommandSchema.safeParse({
        clientId,
        masterLocationId,
        reason: body.reason ?? null,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.rejectMasterLocation.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      return reply.code(200).send({
        masterLocationId,
        rejectedAt: event.time.toISOString(),
      });
    },
  );
}
