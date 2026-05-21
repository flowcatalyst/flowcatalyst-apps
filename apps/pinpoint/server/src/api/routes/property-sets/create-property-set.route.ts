import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreatePropertySetCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

const CreatePropertySetBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const CreatePropertySetResponseSchema = Type.Object({
  propertySetId: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerCreatePropertySetRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/clients/:clientId/layers/:layerId/property-sets',
    {
      schema: {
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        body: CreatePropertySetBodySchema,
        response: {
          201: CreatePropertySetResponseSchema,
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
      const { clientId, layerId } = request.params as { clientId: string; layerId: string };
      const parsed = CreatePropertySetCommandSchema.safeParse({
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

      const result = await appContext.runWrite(
        appContext.useCases.createPropertySet.execute(parsed.data),
        scope,
      );

      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(201).send({
        propertySetId: data.propertySetId,
        createdAt: event.time.toISOString(),
      });
    },
  );
}
