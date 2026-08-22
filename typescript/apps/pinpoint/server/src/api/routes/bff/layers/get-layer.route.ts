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
import { BffLayerDetailResponseRef } from './layer-response.schema.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const ResponseSchema = BffLayerDetailResponseRef;

export function registerBffGetLayerRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/bff/clients/:clientId/layers/:layerId',
    {
      schema: {
        operationId: 'bffGetLayer',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
          401: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
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
