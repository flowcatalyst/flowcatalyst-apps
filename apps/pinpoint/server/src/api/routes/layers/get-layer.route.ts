import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asLayerId } from '../../../domain/layers/ids.js';
import type { AppContext } from '../../../app-context.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

const LayerResponseSchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: NullableString,
  layerType: Type.Union([
    Type.Literal('RADIUS'),
    Type.Literal('POLYGON'),
    Type.Literal('POINT'),
  ]),
  centerLat: NullableNumber,
  centerLon: NullableNumber,
  radiusMeters: NullableNumber,
  polygonGeojson: NullableString,
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE')]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const NotFoundSchema = Type.Object({
  error: Type.Literal('NotFound'),
  message: Type.String(),
});

export function registerGetLayerRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/layers/:id',
    {
      schema: {
        tags: ['Layers'],
        params: Type.Object({ id: Type.String() }),
        response: { 200: LayerResponseSchema, 404: NotFoundSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const layer = await appContext.repositories.layers.findById(asLayerId(id));
      if (!layer) {
        return reply
          .code(404)
          .send({ error: 'NotFound' as const, message: `Layer '${id}' not found.` });
      }
      return {
        ...layer,
        createdAt: layer.createdAt.toISOString(),
        updatedAt: layer.updatedAt.toISOString(),
      };
    },
  );
}
