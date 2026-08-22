import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateMatchingConfigCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

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

export function registerUpdateMatchingConfigRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/clients/:clientId/matching-config',
    {
      schema: {
        operationId: 'updateMatchingConfig',
        tags: ['Matching'],
        params: ParamsSchema,
        body: UpdateMatchingConfigBodySchema,
        response: {
          200: UpdateMatchingConfigResponseSchema,
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
      const parsed = UpdateMatchingConfigCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.updateMatchingConfig.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
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
