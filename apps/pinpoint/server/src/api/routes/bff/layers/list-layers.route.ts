/**
 * BFF layer list. Mirror of Rust `routes/bff/layers.rs::list_layers`.
 * Returns all layers under the client with `propertySetCount` and a
 * `hasPolygon` flag. No pagination — Rust BFF doesn't paginate either.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';

const LayerSchema = Type.Object({
  id: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  layerType: Type.Union([Type.Literal('RADIUS'), Type.Literal('POLYGON'), Type.Literal('POINT')]),
  status: Type.String(),
  centerLat: Type.Union([Type.Number(), Type.Null()]),
  centerLon: Type.Union([Type.Number(), Type.Null()]),
  radiusMeters: Type.Union([Type.Number(), Type.Null()]),
  hasPolygon: Type.Boolean(),
  propertySetCount: Type.Integer({ minimum: 0 }),
  createdAt: Type.String({ format: 'date-time' }),
});

const ResponseSchema = Type.Object({
  items: Type.Array(LayerSchema),
  total: Type.Integer({ minimum: 0 }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

const LIST_LIMIT = 1000;

export function registerBffListLayersRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/layers',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
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

      const { clientId } = request.params as { clientId: string };
      const { layers, total } = await appContext.repositories.layers.listByClient({
        clientId: asClientId(clientId),
        limit: LIST_LIMIT,
        offset: 0,
      });

      const counts = await appContext.repositories.propertySets.countByLayerIds(
        layers.map((l) => l.id),
      );

      return reply.code(200).send({
        items: layers.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          description: l.description,
          layerType: l.layerType,
          status: l.status,
          centerLat: l.centerLat,
          centerLon: l.centerLon,
          radiusMeters: l.radiusMeters,
          hasPolygon: l.polygonGeojson != null,
          propertySetCount: counts.get(l.id) ?? 0,
          createdAt: l.createdAt.toISOString(),
        })),
        total,
      });
    },
  );
}
