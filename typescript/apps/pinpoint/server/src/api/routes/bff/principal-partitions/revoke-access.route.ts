/**
 * DELETE /bff/clients/:clientId/partitions/:partitionId/principals/:principalId
 * Revoke a principal's partition access via the revoke-partition-access use
 * case (emits `pinpoint:tenancy:partition:access-revoked`).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { RevokePartitionAccessCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const ResponseSchema = Type.Object({ success: Type.Literal(true) });

export function registerBffRevokePartitionAccessRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.delete(
    '/bff/clients/:clientId/partitions/:partitionId/principals/:principalId',
    {
      schema: {
        operationId: 'bffRevokeAccess',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
          principalId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
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
      const parsed = RevokePartitionAccessCommandSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.revokePartitionAccess.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      return reply.code(200).send({ success: true });
    },
  );
}
