/**
 * BFF dashboard stats. Mirror of Rust `routes/bff/dashboard.rs::stats`.
 * Returns aggregate counts for the SPA home screen. Today it's just
 * `totalClients`; widen the response shape as new dashboard widgets
 * land (don't remove existing fields — the SPA contract is sticky).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';

const ResponseSchema = Type.Object({
  totalClients: Type.Integer({ minimum: 0 }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffDashboardRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/bff/dashboard/stats',
    {
      schema: {
        tags: ['BFF'],
        response: { 200: ResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (_request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const totalClients = await appContext.repositories.clients.count();
      return reply.code(200).send({ totalClients });
    },
  );
}
