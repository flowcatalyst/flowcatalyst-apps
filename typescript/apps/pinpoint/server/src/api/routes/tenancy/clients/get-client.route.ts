import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const ClientResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  code: Type.String(),
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('SUSPENDED')]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export function registerGetClientRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/clients/:clientId',
    {
      schema: {
        operationId: 'getClient',
        tags: ['Tenancy'],
        params: Type.Object({ clientId: Type.String() }),
        response: { 200: ClientResponseSchema, 404: ErrorResponseRef },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const client = await appContext.repositories.clients.findById(asClientId(clientId));
      if (!client) {
        return reply
          .code(404)
          .send({ error: 'NotFound' as const, message: `Client '${clientId}' not found.` });
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
