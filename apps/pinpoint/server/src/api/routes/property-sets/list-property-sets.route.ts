import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asLayerId } from '../../../domain/layers/ids.js';
import type { AppContext } from '../../../app-context.js';

const PropertySchema = Type.Object({
  id: Type.String(),
  key: Type.String(),
  value: Type.String(),
});

const PropertySetSchema = Type.Object({
  id: Type.String(),
  layerId: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  properties: Type.Array(PropertySchema),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ListPropertySetsResponseSchema = Type.Object({
  propertySets: Type.Array(PropertySetSchema),
});

export function registerListPropertySetsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/layers/:layerId/property-sets',
    {
      schema: {
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        response: { 200: ListPropertySetsResponseSchema },
      },
    },
    async (request) => {
      const { layerId } = request.params as { clientId: string; layerId: string };
      const sets = await appContext.repositories.propertySets.listByLayer(asLayerId(layerId));
      return {
        propertySets: sets.map((set) => ({
          id: set.id,
          layerId: set.layerId,
          name: set.name,
          description: set.description,
          properties: set.properties.map((p) => ({
            id: p.id,
            key: p.key,
            value: p.value,
          })),
          createdAt: set.createdAt.toISOString(),
          updatedAt: set.updatedAt.toISOString(),
        })),
      };
    },
  );
}
