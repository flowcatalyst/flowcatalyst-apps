import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asClientId } from '../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../app-context.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

const LayerSummarySchema = Type.Object({
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

const ListLayersResponseSchema = Type.Object({
  layers: Type.Array(LayerSummarySchema),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
});

const ListLayersQuerySchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export function registerListLayersRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/layers',
    {
      schema: {
        tags: ['Layers'],
        querystring: ListLayersQuerySchema,
        response: { 200: ListLayersResponseSchema },
      },
    },
    async (request) => {
      const { clientId, limit = 50, offset = 0 } = request.query as {
        clientId: string;
        limit?: number;
        offset?: number;
      };
      const result = await appContext.repositories.layers.listByClient({
        clientId: asClientId(clientId),
        limit,
        offset,
      });
      return {
        layers: result.layers.map((layer) => ({
          ...layer,
          createdAt: layer.createdAt.toISOString(),
          updatedAt: layer.updatedAt.toISOString(),
        })),
        total: result.total,
        limit,
        offset,
      };
    },
  );
}
