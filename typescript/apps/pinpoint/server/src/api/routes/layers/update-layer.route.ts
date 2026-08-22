import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateLayerCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const UpdateLayerBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  centerLat: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  centerLon: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  radiusMeters: Type.Optional(Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()])),
  polygonGeojson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE')])),
});

const UpdateLayerResponseSchema = Type.Object({
  layerId: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
});

export function registerUpdateLayerRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.patch(
    '/clients/:clientId/layers/:layerId',
    {
      schema: {
        operationId: 'updateLayer',
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        body: UpdateLayerBodySchema,
        response: {
          200: UpdateLayerResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId, layerId } = request.params as { clientId: string; layerId: string };
      const parsed = UpdateLayerCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
        layerId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.updateLayer.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        layerId: data.layerId,
        updatedAt: event.time.toISOString(),
      });
    },
  );
}
