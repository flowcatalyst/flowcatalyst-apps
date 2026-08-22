import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdatePropertySetCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const UpdatePropertySetBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const UpdatePropertySetResponseSchema = Type.Object({
  propertySetId: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
});

export function registerUpdatePropertySetRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.patch(
    '/clients/:clientId/layers/:layerId/property-sets/:propertySetId',
    {
      schema: {
        operationId: 'updatePropertySet',
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          propertySetId: Type.String({ minLength: 1 }),
        }),
        body: UpdatePropertySetBodySchema,
        response: {
          200: UpdatePropertySetResponseSchema,
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
      const { clientId, layerId, propertySetId } = request.params as {
        clientId: string;
        layerId: string;
        propertySetId: string;
      };
      const parsed = UpdatePropertySetCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
        layerId,
        propertySetId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.updatePropertySet.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        propertySetId: data.propertySetId,
        updatedAt: event.time.toISOString(),
      });
    },
  );
}
