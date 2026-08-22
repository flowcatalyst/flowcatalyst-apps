/**
 * BFF client detail. Mirror of Rust `routes/bff/clients.rs::get_client`.
 * Same flat shape the list returns. 404 when the id doesn't resolve.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId } from '../../../../domain/tenancy/ids.js';
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

export function registerBffGetClientRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/bff/clients/:clientId',
    {
      schema: {
        operationId: 'bffGetClient',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        response: {
          200: ClientSchema,
          401: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { clientId } = request.params as { clientId: string };
      const client = await appContext.repositories.clients.findById(asClientId(clientId));
      if (!client) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Client '${clientId}' not found.` });
      }

      return reply.code(200).send({
        id: client.id,
        name: client.name,
        code: client.code,
        status: client.status,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
      });
    },
  );
}
