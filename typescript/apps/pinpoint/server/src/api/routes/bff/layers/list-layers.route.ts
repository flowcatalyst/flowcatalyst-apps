/**
 * BFF layer list. Mirror of Rust `routes/bff/layers.rs::list_layers`.
 * Returns layers under the client with `propertySetCount` and a `hasPolygon`
 * flag. Optional `page` / `pageSize` / `q` (free-text over code / name /
 * description); with no query it returns everything (up to LIST_LIMIT), which
 * is what the SPA's dropdowns rely on.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

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

const LIST_LIMIT = 1000;

const QuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 0 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_LIMIT })),
  /** Free-text filter over code / name / description (case-insensitive contains). */
  q: Type.Optional(Type.String({ maxLength: 200 })),
});

export function registerBffListLayersRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/bff/clients/:clientId/layers',
    {
      schema: {
        operationId: 'bffListLayers',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        querystring: QuerySchema,
        response: { 200: ResponseSchema, 401: ErrorResponseRef, 500: ErrorResponseRef },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { clientId } = request.params as { clientId: string };
      const {
        page = 0,
        pageSize = LIST_LIMIT,
        q,
      } = request.query as { page?: number; pageSize?: number; q?: string };
      const { layers, total } = await appContext.repositories.layers.listByClient({
        clientId: asClientId(clientId),
        search: q,
        limit: pageSize,
        offset: page * pageSize,
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
