import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';

const ClientSummarySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  code: Type.String(),
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('SUSPENDED')]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ListClientsResponseSchema = Type.Object({
  clients: Type.Array(ClientSummarySchema),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
});

const ListClientsQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export function registerListClientsRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/clients',
    {
      schema: {
        tags: ['Tenancy'],
        querystring: ListClientsQuerySchema,
        response: { 200: ListClientsResponseSchema },
      },
    },
    async (request) => {
      const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number };
      const result = await appContext.repositories.clients.listAll({ limit, offset });
      return {
        clients: result.clients.map((client) => ({
          id: client.id,
          name: client.name,
          code: client.code,
          status: client.status,
          createdAt: client.createdAt.toISOString(),
          updatedAt: client.updatedAt.toISOString(),
        })),
        total: result.total,
        limit,
        offset,
      };
    },
  );
}
