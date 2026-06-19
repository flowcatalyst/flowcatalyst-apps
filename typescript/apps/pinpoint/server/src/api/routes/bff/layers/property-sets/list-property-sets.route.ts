/**
 * BFF property-set list. Mirror of Rust
 * `routes/bff/layers.rs::list_property_sets`. Returns the full set with
 * inline properties (matches the layer detail response shape).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asLayerId } from '../../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../../app-context.js';

const PropertySchema = Type.Object({ key: Type.String(), value: Type.String() });

const ItemSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  properties: Type.Array(PropertySchema),
});

const ResponseSchema = Type.Object({
  items: Type.Array(ItemSchema),
  total: Type.Integer({ minimum: 0 }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffListPropertySetsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/layers/:layerId/property-sets',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        response: { 200: ResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { layerId } = request.params as { clientId: string; layerId: string };
      const sets = await appContext.repositories.propertySets.listByLayer(asLayerId(layerId));

      return reply.code(200).send({
        items: sets.map((ps) => ({
          id: ps.id,
          name: ps.name,
          description: ps.description,
          properties: ps.properties.map((p) => ({ key: p.key, value: p.value })),
        })),
        total: sets.length,
      });
    },
  );
}
