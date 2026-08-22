/**
 * POST /bff/clients/:clientId/partitions/:partitionId/principals
 * Grant a principal access to a partition via the grant-partition-access use
 * case (emits `pinpoint:tenancy:partition:access-granted`).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { GrantPartitionAccessCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const BodySchema = Type.Object({ principalId: Type.String({ minLength: 1 }) });
const ResponseSchema = Type.Object({ success: Type.Literal(true) });

export function registerBffGrantPartitionAccessRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/partitions/:partitionId/principals',
    {
      schema: {
        operationId: 'bffGrantAccess',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
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
      const params = request.params as { clientId: string; partitionId: string };
      const { principalId } = request.body as { principalId: string };
      const parsed = GrantPartitionAccessCommandSchema.safeParse({ ...params, principalId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.grantPartitionAccess.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      return reply.code(200).send({ success: true });
    },
  );
}
