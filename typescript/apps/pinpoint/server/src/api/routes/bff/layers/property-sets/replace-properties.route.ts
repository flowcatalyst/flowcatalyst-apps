/**
 * BFF property-set bulk replace. Mirror of Rust
 * `routes/bff/layers.rs::replace_properties`. Caps at 6 properties
 * (enforced by the canonical command schema). Returns `{success: true}`.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { ReplacePropertySetPropertiesCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../../app-context.js';
import { sendUseCaseError } from '../../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';

const PropertySchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  value: Type.String(),
});

const BodySchema = Type.Object({
  properties: Type.Array(PropertySchema, { maxItems: 6 }),
});

const ResponseSchema = Type.Object({ success: Type.Literal(true) });

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerBffReplacePropertySetPropertiesRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/layers/:layerId/property-sets/:propertySetId/properties',
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
      const parsed = ReplacePropertySetPropertiesCommandSchema.safeParse({
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
        appContext.useCases.replacePropertySetProperties.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }
      return reply.code(200).send({ success: true });
    },
  );
}
