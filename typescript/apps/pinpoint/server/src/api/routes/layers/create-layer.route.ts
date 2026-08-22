import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateLayerCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const CreateLayerParamsSchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
});

const CreateLayerBodySchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  layerType: Type.Union([Type.Literal('RADIUS'), Type.Literal('POLYGON'), Type.Literal('POINT')]),
  centerLat: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  centerLon: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  radiusMeters: Type.Optional(Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()])),
  polygonGeojson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const CreateLayerResponseSchema = Type.Object({
  layerId: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

export function registerCreateLayerRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/clients/:clientId/layers',
    {
      schema: {
        operationId: 'createLayer',
        tags: ['Layers'],
        params: CreateLayerParamsSchema,
        body: CreateLayerBodySchema,
        response: {
          201: CreateLayerResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          409: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const parsed = CreateLayerCommandSchema.safeParse({
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
        appContext.useCases.createLayer.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(201).send({
        layerId: data.layerId,
        createdAt: event.time.toISOString(),
      });
    },
  );
}
