/**
 * BFF layer-feature delete. Mirror of Rust
 * `routes/bff/layer_features.rs::delete_feature`.
 */
import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { DeleteLayerFeatureCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

const ResponseSchema = Type.Object({ success: Type.Literal(true) });

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
});

export function registerBffDeleteLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/bff/clients/:clientId/layers/:layerId/features/:featureId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          featureId: Type.String({ minLength: 1 }),
        }),
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
      const { featureId } = request.params as {
        clientId: string;
        layerId: string;
        featureId: string;
      };
      const parsed = DeleteLayerFeatureCommandSchema.safeParse({ featureId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError' });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.deleteLayerFeature.execute(parsed.data),
        scope,
      );
      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }
      return reply.code(200).send({ success: true });
    },
  );
}
