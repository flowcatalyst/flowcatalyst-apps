/**
 * BFF property-set update. Mirror of Rust
 * `routes/bff/layers.rs::update_property_set`. Returns `{success: true}`
 * matching Rust shape; the SPA re-fetches via layer detail.
 */
import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdatePropertySetCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../../app-context.js';
import { sendUseCaseError } from '../../../../plugins/error-mapper.js';

const BodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ResponseSchema = Type.Object({ success: Type.Literal(true) });

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerBffUpdatePropertySetRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/layers/:layerId/property-sets/:propertySetId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          propertySetId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
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
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.updatePropertySet.execute(parsed.data),
        scope,
      );
      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }
      return reply.code(200).send({ success: true });
    },
  );
}
