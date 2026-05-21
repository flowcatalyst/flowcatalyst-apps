/**
 * Revoke a principal's access to a partition. Mirror of Rust
 * `routes/bff/principal_partitions.rs::revoke_access`.
 *
 * Returns `{success: true}` regardless of whether the grant existed
 * — matches Rust (idempotent revoke). The repo method returns a
 * boolean we currently ignore; could surface it as `{deleted}` later
 * if the SPA wants to distinguish "no-op revoke" from "actually
 * revoked".
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asPartitionId } from '../../../../domain/tenancy/ids.js';
import { asPrincipalId } from '../../../../domain/auth/ids.js';
import type { AppContext } from '../../../../app-context.js';

const ResponseSchema = Type.Object({ success: Type.Literal(true) });

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffRevokePartitionAccessRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/bff/clients/:clientId/partitions/:partitionId/principals/:principalId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
          principalId: Type.String({ minLength: 1 }),
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

      const { partitionId, principalId } = request.params as {
        clientId: string;
        partitionId: string;
        principalId: string;
      };

      await appContext.repositories.principals.revokePartitionAccess(
        asPrincipalId(principalId),
        asPartitionId(partitionId),
      );

      return reply.code(200).send({ success: true });
    },
  );
}
