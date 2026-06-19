/**
 * BFF layer-feature detail. Mirror of Rust
 * `routes/bff/layer_features.rs::get_feature`.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asLayerFeatureId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';

const ResponseSchema = Type.Object({
  id: Type.String(),
  layerId: Type.String(),
  label: Type.String(),
  centerLat: Type.Union([Type.Number(), Type.Null()]),
  centerLon: Type.Union([Type.Number(), Type.Null()]),
  radiusMeters: Type.Union([Type.Number(), Type.Null()]),
  polygonGeojson: Type.Union([Type.String(), Type.Null()]),
  propertyValues: Type.Record(Type.String(), Type.String()),
  status: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffGetLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/layers/:layerId/features/:featureId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          featureId: Type.String({ minLength: 1 }),
        }),
        response: { 200: ResponseSchema, 401: ErrorSchema, 404: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { featureId } = request.params as {
        clientId: string;
        layerId: string;
        featureId: string;
      };
      const feature = await appContext.repositories.layerFeatures.findById(
        asLayerFeatureId(featureId),
      );
      if (!feature) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Feature '${featureId}' not found.` });
      }

      return reply.code(200).send({
        id: feature.id,
        layerId: feature.layerId,
        label: feature.label,
        centerLat: feature.centerLat,
        centerLon: feature.centerLon,
        radiusMeters: feature.radiusMeters,
        polygonGeojson: feature.polygonGeojson,
        propertyValues: feature.propertyValues as Record<string, string>,
        status: feature.status,
        createdAt: feature.createdAt.toISOString(),
        updatedAt: feature.updatedAt.toISOString(),
      });
    },
  );
}
