/**
 * BFF property-set create. Mirror of Rust
 * `routes/bff/layers.rs::create_property_set`.
 *
 * Rust BFF enforces "one property set per layer" at the route level
 * (even though the DB allows multiple sets with different names).
 * Preserved here for SPA contract compatibility — reject with 409
 * if the layer already has any property set.
 *
 * Delegates to `create-property-set` via runWrite, then re-reads the
 * set to return the full SPA-shaped detail (matches Rust shape).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreatePropertySetCommandSchema } from '@pinpoint/shared';
import { asLayerId, asPropertySetId } from '../../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../../app-context.js';
import { sendUseCaseError } from '../../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';

const BodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  properties: Type.Array(Type.Object({ key: Type.String(), value: Type.String() })),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerBffCreatePropertySetRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/layers/:layerId/property-sets',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          201: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
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
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      // Rust BFF: one property set per layer.
      const existing = await appContext.repositories.propertySets.listByLayer(asLayerId(layerId));
      if (existing.length > 0) {
        return reply.code(409).send({
          error: 'BusinessRuleViolation',
          code: 'PROPERTY_SET_LIMIT',
          message: 'A layer can only have one property set.',
        });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.createPropertySet.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const data = result.value.getData();
      const set = await appContext.repositories.propertySets.findById(
        asPropertySetId(data.propertySetId),
      );
      if (!set) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `PropertySet '${data.propertySetId}' not found after create.`,
        });
      }

      return reply.code(201).send({
        id: set.id,
        name: set.name,
        description: set.description,
        properties: set.properties.map((p) => ({ key: p.key, value: p.value })),
      });
    },
  );
}
