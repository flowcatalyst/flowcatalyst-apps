/**
 * BFF dashboard stats. Mirror of Rust `routes/bff/dashboard.rs::stats`.
 * Returns aggregate counts for the SPA home screen. Widen the response shape
 * as new dashboard widgets land (don't remove existing fields — the SPA
 * contract is sticky).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const ResponseSchema = Type.Object({
  totalClients: Type.Integer({ minimum: 0 }),
  totalLocations: Type.Integer({ minimum: 0 }),
  totalMasterLocations: Type.Integer({ minimum: 0 }),
  totalLayers: Type.Integer({ minimum: 0 }),
});

export function registerBffDashboardRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/bff/dashboard/stats',
    {
      schema: {
        operationId: 'bffDashboard',
        tags: ['BFF'],
        response: { 200: ResponseSchema, 401: ErrorResponseRef, 500: ErrorResponseRef },
      },
    },
    async (_request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const [totalClients, totalLocations, totalMasterLocations, totalLayers] = await Promise.all([
        appContext.repositories.clients.count(),
        appContext.repositories.locations.count(),
        appContext.repositories.masterLocations.count(),
        appContext.repositories.layers.count(),
      ]);
      return reply
        .code(200)
        .send({ totalClients, totalLocations, totalMasterLocations, totalLayers });
    },
  );
}
