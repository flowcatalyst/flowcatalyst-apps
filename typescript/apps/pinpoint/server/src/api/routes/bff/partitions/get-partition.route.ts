/**
 * BFF partition detail. Mirror of Rust `routes/bff/partitions.rs::get_partition`.
 * `:clientId` is in the path for scoping but not actually checked against
 * the partition's owning client (matches Rust). Real authz check lands
 * with OIDC in Slice 12.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asPartitionId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { BffPartitionRef } from './partition.schema.js';

const ResponseSchema = BffPartitionRef;

export function registerBffGetPartitionRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/partitions/:partitionId',
    {
      schema: {
        operationId: 'bffGetPartition',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          partitionId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
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

      const { partitionId } = request.params as { clientId: string; partitionId: string };
      const partition = await appContext.repositories.partitions.findById(
        asPartitionId(partitionId),
      );
      if (!partition) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Partition '${partitionId}' not found.` });
      }

      return reply.code(200).send({
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
