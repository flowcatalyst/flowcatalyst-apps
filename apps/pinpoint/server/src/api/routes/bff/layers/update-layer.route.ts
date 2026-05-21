/**
 * BFF layer update. Mirror of Rust `routes/bff/layers.rs::update_layer`.
 * Returns the BFF-shaped detail (re-fetched after commit, includes
 * property sets but always empty partitionIds in Rust — preserved here).
 */
import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateLayerCommandSchema } from '@pinpoint/shared';
import { asLayerId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

const BodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  centerLat: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  centerLon: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  radiusMeters: Type.Optional(Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()])),
  polygonGeojson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  layerType: Type.Union([Type.Literal('RADIUS'), Type.Literal('POLYGON'), Type.Literal('POINT')]),
  status: Type.String(),
  centerLat: Type.Union([Type.Number(), Type.Null()]),
  centerLon: Type.Union([Type.Number(), Type.Null()]),
  radiusMeters: Type.Union([Type.Number(), Type.Null()]),
  polygonGeojson: Type.Union([Type.String(), Type.Null()]),
  propertySets: Type.Array(Type.Unknown()),
  partitionIds: Type.Array(Type.String()),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerBffUpdateLayerRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/layers/:layerId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId, layerId } = request.params as {
        clientId: string;
        layerId: string;
      };
      const body = request.body as {
        name: string;
        description?: string | null;
        centerLat?: number | null;
        centerLon?: number | null;
        radiusMeters?: number | null;
        polygonGeojson?: string | null;
      };

      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      // BFF accepts partial updates (matches Rust). The canonical
      // update-layer command treats the geometry fields as a complete
      // replacement and validates that RADIUS layers carry lat+lon,
      // POLYGON carries polygon, etc. — so any field the caller omitted
      // gets carried over from the current row.
      const lid = asLayerId(layerId);
      const existing = await appContext.repositories.layers.findById(lid);
      if (!existing) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Layer '${layerId}' not found.` });
      }

      const parsed = UpdateLayerCommandSchema.safeParse({
        clientId,
        layerId,
        name: body.name,
        description: body.description === undefined ? existing.description : body.description,
        centerLat: body.centerLat === undefined ? existing.centerLat : body.centerLat,
        centerLon: body.centerLon === undefined ? existing.centerLon : body.centerLon,
        radiusMeters:
          body.radiusMeters === undefined ? existing.radiusMeters : body.radiusMeters,
        polygonGeojson:
          body.polygonGeojson === undefined ? existing.polygonGeojson : body.polygonGeojson,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const result = await appContext.runWrite(
        appContext.useCases.updateLayer.execute(parsed.data),
        scope,
      );
      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const [layer, propertySets] = await Promise.all([
        appContext.repositories.layers.findById(lid),
        appContext.repositories.propertySets.listByLayer(lid),
      ]);
      if (!layer) {
        return reply
          .code(500)
          .send({ error: 'InfrastructureError', message: `Layer '${layerId}' not found after update.` });
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
        partitionIds: [],
        createdAt: layer.createdAt.toISOString(),
      });
    },
  );
}
