/**
 * BFF spatial-lookup. Mirror of Rust `routes/bff/spatial_lookup.rs`.
 *
 * Differs from the non-BFF `/spatial-lookup` route in two ways:
 *   1. clientId is in the path, not the body
 *   2. partition is named by `partitionCode` (resolved here against
 *      `partitionRepo.findByClientAndCode`) rather than by raw id
 *
 * The SPA prefers stable codes over TSIDs in its URL shape, which is
 * why this exists alongside the canonical route.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';

const BodySchema = Type.Object({
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
  partitionCode: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  layerCodes: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

const HitSchema = Type.Object({
  layerId: Type.String(),
  layerCode: Type.String(),
  layerName: Type.String(),
  layerType: Type.Union([Type.Literal('RADIUS'), Type.Literal('POLYGON'), Type.Literal('POINT')]),
  featureId: Type.String(),
  featureLabel: Type.String(),
  distanceMeters: Type.Union([Type.Number(), Type.Null()]),
  properties: Type.Record(Type.String(), Type.String()),
});

const ResponseSchema = Type.Object({
  latitude: Type.Number(),
  longitude: Type.Number(),
  results: Type.Array(HitSchema),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffSpatialLookupRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/spatial-lookup',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
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

      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        latitude: number;
        longitude: number;
        partitionCode?: string | null;
        layerCodes?: readonly string[];
      };

      const client = asClientId(clientId);

      // Resolve partition code → id (BFF-only convenience; the non-BFF
      // route takes the raw id).
      let partitionId = null;
      if (body.partitionCode && body.partitionCode.length > 0) {
        const partition = await appContext.repositories.partitions.findByClientAndCode(
          client,
          body.partitionCode,
        );
        if (!partition) {
          return reply
            .code(404)
            .send({ error: 'NotFound', message: `Partition '${body.partitionCode}' not found.` });
        }
        partitionId = partition.id;
      }

      const results = await appContext.repositories.layerFeatures.spatialLookup({
        clientId: client,
        partitionId,
        latitude: body.latitude,
        longitude: body.longitude,
        layerCodes: body.layerCodes ?? null,
      });

      return reply.code(200).send({
        latitude: body.latitude,
        longitude: body.longitude,
        results: results.map((r) => ({
          layerId: r.layerId,
          layerCode: r.layerCode,
          layerName: r.layerName,
          layerType: r.layerType,
          featureId: r.featureId,
          featureLabel: r.featureLabel,
          distanceMeters: r.distanceMeters,
          properties: r.propertyValues as Record<string, string>,
        })),
      });
    },
  );
}
