/**
 * BFF "who has access to this partition" list. Mirror of Rust
 * `routes/bff/principal_partitions.rs::list_principals`. Items carry the
 * grantedAt timestamp from the principal_partitions row, used by the
 * SPA's permissions panel.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asPartitionId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';

const PrincipalSchema = Type.Object({
  id: Type.String(),
  principalType: Type.String(),
  name: Type.String(),
  email: Type.Union([Type.String(), Type.Null()]),
  grantedAt: Type.String({ format: 'date-time' }),
});

const ResponseSchema = Type.Object({
  items: Type.Array(PrincipalSchema),
  total: Type.Integer({ minimum: 0 }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffListPrincipalsForPartitionRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/partitions/:partitionId/principals',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
        }),
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

      const { partitionId } = request.params as { clientId: string; partitionId: string };
      const rows = await appContext.repositories.principals.findPrincipalsForPartition(
        asPartitionId(partitionId),
      );

      return reply.code(200).send({
        items: rows.map((r) => ({
          id: r.principal.id,
          principalType: r.principal.principalType,
          name: r.principal.name,
          email: r.principal.email,
          grantedAt: r.grantedAt.toISOString(),
        })),
        total: rows.length,
      });
    },
  );
}
