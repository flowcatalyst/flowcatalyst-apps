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
    '/layer-features/:id',
    {
      schema: {
        tags: ['Layers'],
        params: Type.Object({ id: Type.String() }),
        response: { 200: LayerFeatureResponseSchema, 404: NotFoundSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const feature = await appContext.repositories.layerFeatures.findById(asLayerFeatureId(id));
      if (!feature) {
        return reply
          .code(404)
          .send({ error: 'NotFound' as const, message: `Layer feature '${id}' not found.` });
      }
      return {
        ...feature,
        createdAt: feature.createdAt.toISOString(),
        updatedAt: feature.updatedAt.toISOString(),
      };
    },
  );
}
