/**
 * BFF layer detail. Mirror of Rust `routes/bff/layers.rs::get_layer`.
 * Loads layer + property sets (with inline properties) + partition
 * assignments in three parallel reads.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asLayerId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';

const PropertySchema = Type.Object({ key: Type.String(), value: Type.String() });

const PropertySetSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  properties: Type.Array(PropertySchema),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  layerType: Type.Union([Type.Literal('RADIUS'), Type.Literal('POLYGON'), Type.Literal('POINT')]),
  status: Type.String(),
  centerLat: Type.Union([Type.Number(), Type.Null()]),
  centerLon: Type.Union([Type.Number(), Type.Null()]),
  radiusMeters: Type.Union([Type.Number(), Type.Null()]),
  polygonGeojson: Type.Union([Type.String(), Type.Null()]),
  propertySets: Type.Array(PropertySetSchema),
  partitionIds: Type.Array(Type.String()),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffGetLayerRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/bff/clients/:clientId/layers/:layerId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        response: { 200: ResponseSchema, 401: ErrorSchema, 404: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { layerId } = request.params as { clientId: string; layerId: string };
      const lid = asLayerId(layerId);

      const [layer, propertySets, partitionIds] = await Promise.all([
        appContext.repositories.layers.findById(lid),
        appContext.repositories.propertySets.listByLayer(lid),
        appContext.repositories.layers.findPartitionIds(lid),
      ]);
      if (!layer) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Layer '${layerId}' not found.` });
      }

      return reply.code(200).send({
        id: layer.id,
        code: layer.code,
        name: layer.name,
        description: layer.description,
        layerType: layer.layerType,
        status: layer.status,
        centerLat: layer.centerLat,
        centerLon: layer.centerLon,
        radiusMeters: layer.radiusMeters,
        polygonGeojson: layer.polygonGeojson,
        propertySets: propertySets.map((ps) => ({
          id: ps.id,
          name: ps.name,
          description: ps.description,
          properties: ps.properties.map((p) => ({ key: p.key, value: p.value })),
        })),
        partitionIds: [...partitionIds],
        createdAt: layer.createdAt.toISOString(),
      });
    },
  );
}
