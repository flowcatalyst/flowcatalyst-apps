/**
 * BFF client list. Mirror of Rust `routes/bff/clients.rs::list_clients`.
 *
 * Returns `{items, total}` — the SPA standard list framing. Rust uses
 * `offset=0, limit=100` with no pagination params, so we do the same.
 * When/if the SPA grows pagination controls, add the query params then.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../../app-context.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const ClientSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  code: Type.String(),
  status: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ResponseSchema = Type.Object({
  items: Type.Array(ClientSchema),
  total: Type.Integer({ minimum: 0 }),
});

const LIST_LIMIT = 100;

export function registerBffListClientsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients',
    {
      schema: {
        operationId: 'bffListClients',
        tags: ['BFF'],
        response: { 200: ResponseSchema, 401: ErrorResponseRef, 500: ErrorResponseRef },
      },
    },
    async (_request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { clients, total } = await appContext.repositories.clients.listAll({
        limit: LIST_LIMIT,
        offset: 0,
      });

      return reply.code(200).send({
        items: clients.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        total,
      });
    },
  );
}
