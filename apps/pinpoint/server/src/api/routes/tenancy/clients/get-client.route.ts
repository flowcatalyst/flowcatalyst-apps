import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';

const ClientResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  code: Type.String(),
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('SUSPENDED')]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const NotFoundSchema = Type.Object({
  error: Type.Literal('NotFound'),
  message: Type.String(),
});

export function registerGetClientRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/clients/:id',
    {
      schema: {
        tags: ['Tenancy'],
        params: Type.Object({ id: Type.String() }),
        response: { 200: ClientResponseSchema, 404: NotFoundSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const client = await appContext.repositories.clients.findById(asClientId(id));
      if (!client) {
        return reply.code(404).send({ error: 'NotFound' as const, message: `Client '${id}' not found.` });
      }
      return {
        id: client.id,
        name: client.name,
        code: client.code,
        status: client.status,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
      };
    },
  );
}
