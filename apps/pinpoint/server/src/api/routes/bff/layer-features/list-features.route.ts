/**
 * BFF layer-feature list. Mirror of Rust
 * `routes/bff/layer_features.rs::list_features`. Returns all features
 * under a layer — no pagination (matches Rust).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asLayerId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';

const FeatureSchema = Type.Object({
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

const ResponseSchema = Type.Object({
  items: Type.Array(FeatureSchema),
  total: Type.Integer({ minimum: 0 }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

const LIST_LIMIT = 1000;

export function registerBffListLayerFeaturesRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/layers/:layerId/features',
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
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { layerId } = request.params as { clientId: string; layerId: string };
      const { features, total } = await appContext.repositories.layerFeatures.listByLayer({
        layerId: asLayerId(layerId),
        limit: LIST_LIMIT,
        offset: 0,
      });

      return reply.code(200).send({
        items: features.map((f) => ({
          id: f.id,
          layerId: f.layerId,
          label: f.label,
          centerLat: f.centerLat,
          centerLon: f.centerLon,
          radiusMeters: f.radiusMeters,
          polygonGeojson: f.polygonGeojson,
          propertyValues: f.propertyValues as Record<string, string>,
          status: f.status,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
        })),
        total,
      });
    },
  );
}
