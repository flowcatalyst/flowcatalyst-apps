import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asLayerFeatureId } from '../../../domain/layers/ids.js';
import type { AppContext } from '../../../app-context.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

const LayerFeatureResponseSchema = Type.Object({
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

const NotFoundSchema = Type.Object({
  error: Type.Literal('NotFound'),
  message: Type.String(),
});

export function registerGetLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/clients/:clientId/layers/:layerId/features/:featureId',
    {
      schema: {
        tags: ['Layers'],
        params: Type.Object({
          clientId: Type.String(),
          layerId: Type.String(),
          featureId: Type.String(),
        }),
        response: { 200: LayerFeatureResponseSchema, 404: NotFoundSchema },
      },
    },
    async (request, reply) => {
      const { featureId } = request.params as {
        clientId: string;
        layerId: string;
        featureId: string;
      };
      const feature = await appContext.repositories.layerFeatures.findById(
        asLayerFeatureId(featureId),
      );
      if (!feature) {
        return reply.code(404).send({
          error: 'NotFound' as const,
          message: `Layer feature '${featureId}' not found.`,
        });
      }
      return {
        ...feature,
        createdAt: feature.createdAt.toISOString(),
        updatedAt: feature.updatedAt.toISOString(),
      };
    },
  );
}
