/**
 * Grant a principal access to a partition. Mirror of Rust
 * `routes/bff/principal_partitions.rs::grant_access`.
 *
 * No use case wrapper — `grantPartitionAccess` is a plain repo method
 * (Slice 10b.3). The body carries the target `principalId`; the
 * `grantedBy` is the current principal from the scope. 404 if the
 * target principal doesn't exist (matches Rust). Re-granting is a
 * no-op via `ON CONFLICT DO NOTHING` in the repo.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asPartitionId } from '../../../../domain/tenancy/ids.js';
import { asPrincipalId } from '../../../../domain/auth/ids.js';
import type { AppContext } from '../../../../app-context.js';

const BodySchema = Type.Object({ principalId: Type.String({ minLength: 1 }) });

const ResponseSchema = Type.Object({ success: Type.Literal(true) });

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffGrantPartitionAccessRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/partitions/:partitionId/principals',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { partitionId } = request.params as { clientId: string; partitionId: string };
      const { principalId } = request.body as { principalId: string };

      const target = await appContext.repositories.principals.findById(asPrincipalId(principalId));
      if (!target) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Principal '${principalId}' not found.` });
      }

      await appContext.repositories.principals.grantPartitionAccess(
        target.id,
        asPartitionId(partitionId),
        asPrincipalId(scope.principalId),
      );

      return reply.code(200).send({ success: true });
    },
  );
}
