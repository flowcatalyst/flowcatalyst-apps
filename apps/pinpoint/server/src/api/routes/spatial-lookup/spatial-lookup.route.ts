import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId, asPartitionId } from '../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../app-context.js';

const SpatialLookupBodySchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
  partitionId: Type.Optional(Type.String()),
  layerCodes: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

const SpatialLookupHitSchema = Type.Object({
  layerId: Type.String(),
  layerCode: Type.String(),
  layerName: Type.String(),
  layerType: Type.Union([
    Type.Literal('RADIUS'),
    Type.Literal('POLYGON'),
    Type.Literal('POINT'),
  ]),
  featureId: Type.String(),
  featureLabel: Type.String(),
  distanceMeters: Type.Union([Type.Number(), Type.Null()]),
  propertyValues: Type.Record(Type.String(), Type.String()),
  centerLat: Type.Union([Type.Number(), Type.Null()]),
  centerLon: Type.Union([Type.Number(), Type.Null()]),
  radiusMeters: Type.Union([Type.Number(), Type.Null()]),
  polygonPoints: Type.Union([Type.String(), Type.Null()]),
});

const SpatialLookupResponseSchema = Type.Object({
  latitude: Type.Number(),
  longitude: Type.Number(),
  results: Type.Array(SpatialLookupHitSchema),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerSpatialLookupRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/spatial-lookup',
    {
      schema: {
        tags: ['Matching'],
        body: SpatialLookupBodySchema,
        response: {
          200: SpatialLookupResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const body = request.body as {
        clientId: string;
        latitude: number;
        longitude: number;
        partitionId?: string;
        layerCodes?: readonly string[];
      };

      const results = await appContext.repositories.layerFeatures.spatialLookup({
        clientId: asClientId(body.clientId),
        partitionId:
          body.partitionId && body.partitionId.length > 0
            ? asPartitionId(body.partitionId)
            : null,
        latitude: body.latitude,
        longitude: body.longitude,
        layerCodes: body.layerCodes ?? null,
      });

      return reply.code(200).send({
        latitude: body.latitude,
        longitude: body.longitude,
        results: results.map((r) => ({ ...r })),
      });
    },
  );
}
