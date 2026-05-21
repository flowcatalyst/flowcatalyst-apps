import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asLayerId } from '../../../domain/layers/ids.js';
import type { AppContext } from '../../../app-context.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

const LayerFeatureSummarySchema = Type.Object({
  id: Type.String(),
  layerId: Type.String(),
  label: Type.String(),
  centerLat: NullableNumber,
  centerLon: NullableNumber,
  radiusMeters: NullableNumber,
  polygonGeojson: NullableString,
  propertyValues: Type.Record(Type.String(), Type.String()),
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE')]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ListLayerFeaturesResponseSchema = Type.Object({
  features: Type.Array(LayerFeatureSummarySchema),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
});

const ListLayerFeaturesQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export function registerListLayerFeaturesRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/layers/:layerId/features',
    {
      schema: {
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String(),
          layerId: Type.String(),
        }),
        querystring: ListLayerFeaturesQuerySchema,
        response: { 200: ListLayerFeaturesResponseSchema },
      },
    },
    async (request) => {
      const { layerId } = request.params as { clientId: string; layerId: string };
      const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number };
      const result = await appContext.repositories.layerFeatures.listByLayer({
        layerId: asLayerId(layerId),
        limit,
        offset,
      });
      return {
        features: result.features.map((f) => ({
          ...f,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
        })),
        total: result.total,
        limit,
        offset,
      };
    },
  );
}
