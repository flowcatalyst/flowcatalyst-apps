import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateMatchingConfigCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

const ThresholdSchema = Type.Number({ minimum: 0, maximum: 1 });

const ParamsSchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
});

const UpdateMatchingConfigBodySchema = Type.Object({
  partitionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  streetThreshold: Type.Optional(ThresholdSchema),
  houseNumberThreshold: Type.Optional(ThresholdSchema),
  postalCodeThreshold: Type.Optional(ThresholdSchema),
  stateThreshold: Type.Optional(ThresholdSchema),
  addressNameThreshold: Type.Optional(ThresholdSchema),
  overallThreshold: Type.Optional(ThresholdSchema),
});

const UpdateMatchingConfigResponseSchema = Type.Object({
  configId: Type.String(),
  clientId: Type.Union([Type.String(), Type.Null()]),
  partitionId: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerUpdateMatchingConfigRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/clients/:clientId/matching-config',
    {
      schema: {
        tags: ['Matching'],
        params: ParamsSchema,
        body: UpdateMatchingConfigBodySchema,
        response: {
          200: UpdateMatchingConfigResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const parsed = UpdateMatchingConfigCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.updateMatchingConfig.execute(parsed.data),
        scope,
      );

      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(200).send({
        configId: data.configId,
        clientId: data.clientId,
        partitionId: data.partitionId,
        updatedAt: event.time.toISOString(),
      });
    },
  );
}
