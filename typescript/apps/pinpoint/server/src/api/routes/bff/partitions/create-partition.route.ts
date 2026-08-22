/**
 * BFF partition create. Mirror of Rust `routes/bff/partitions.rs::create_partition`.
 *
 * Delegates to the existing `create-partition` use case via `runWrite`
 * (gives us audit + outbox event + tx) instead of inlining the Rust
 * version's direct-repo-insert path. After commit the route re-reads
 * the partition by id and returns the full SPA-shaped detail.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreatePartitionCommandSchema } from '@pinpoint/shared';
import { asPartitionId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const BodySchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export function registerBffCreatePartitionRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/partitions',
    {
      schema: {
        operationId: 'bffCreatePartition',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        body: BodySchema,
        response: {
          201: ResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          409: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const parsed = CreatePartitionCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.createPartition.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      // Re-read the just-created partition to return the SPA-shaped detail.
      const data = result.value.getData();
      const partition = await appContext.repositories.partitions.findById(
        asPartitionId(data.partitionId),
      );
      if (!partition) {
        // Should never happen — the tx just committed it. Defensive 500.
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Partition '${data.partitionId}' not found after create.`,
        });
      }

      return reply.code(201).send({
        id: partition.id,
        code: partition.code,
        name: partition.name,
        description: partition.description,
        createdAt: partition.createdAt.toISOString(),
        updatedAt: partition.updatedAt.toISOString(),
      });
    },
  );
}
