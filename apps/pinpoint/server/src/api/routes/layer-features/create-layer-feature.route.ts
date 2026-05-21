import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateLayerFeatureCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

const CreateLayerFeatureParamsSchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
  layerId: Type.String({ minLength: 1 }),
});

const CreateLayerFeatureBodySchema = Type.Object({
  label: Type.String({ minLength: 1 }),
  centerLat: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  centerLon: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  radiusMeters: Type.Optional(Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()])),
  polygonGeojson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  propertyValues: Type.Optional(Type.Record(Type.String(), Type.String())),
});

const CreateLayerFeatureResponseSchema = Type.Object({
  featureId: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerCreateLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/clients/:clientId/layers/:layerId/features',
    {
      schema: {
        tags: ['Layers'],
        params: CreateLayerFeatureParamsSchema,
        body: CreateLayerFeatureBodySchema,
        response: {
          201: CreateLayerFeatureResponseSchema,
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
      const { layerId } = request.params as { clientId: string; layerId: string };
      const parsed = CreateLayerFeatureCommandSchema.safeParse({
        ...(request.body as object),
        layerId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.createLayerFeature.execute(parsed.data),
        scope,
      );

      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(201).send({
        featureId: data.featureId,
        createdAt: event.time.toISOString(),
      });
    },
  );
}
