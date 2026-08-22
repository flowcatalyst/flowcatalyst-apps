/**
 * BFF property-set delete. Mirror of Rust
 * `routes/bff/layers.rs::delete_property_set`. Child properties cascade
 * on FK. Returns `{success: true}`.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { DeletePropertySetCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../../app-context.js';
import { sendUseCaseError } from '../../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../../plugins/error-response.schema.js';

const ResponseSchema = Type.Object({ success: Type.Literal(true) });

export function registerBffDeletePropertySetRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/bff/clients/:clientId/layers/:layerId/property-sets/:propertySetId',
    {
      schema: {
        operationId: 'bffDeletePropertySet',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          propertySetId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          404: ErrorResponseRef,
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
      const parsed = DeletePropertySetCommandSchema.safeParse({
        clientId,
        layerId,
        propertySetId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError' });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.deletePropertySet.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }
      return reply.code(200).send({ success: true });
    },
  );
}
