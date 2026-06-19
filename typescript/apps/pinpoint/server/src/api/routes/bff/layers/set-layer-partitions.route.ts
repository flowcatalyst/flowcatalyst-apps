/**
 * Set partition assignments for a layer. Mirror of Rust BFF
 * `set_layer_partitions`. Empty array = wildcard (applies to all
 * partitions). Plain repo call — no aggregate / event (matches Rust).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asLayerId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';

const BodySchema = Type.Object({
  partitionIds: Type.Array(Type.String({ minLength: 1 })),
});

const ResponseSchema = Type.Object({
  partitionIds: Type.Array(Type.String()),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffSetLayerPartitionsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/layers/:layerId/partitions',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: { 200: ResponseSchema, 401: ErrorSchema, 404: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { layerId } = request.params as { clientId: string; layerId: string };
      const { partitionIds } = request.body as { partitionIds: readonly string[] };

      await appContext.repositories.layers.setPartitionIds(asLayerId(layerId), partitionIds);
      return reply.code(200).send({ partitionIds: [...partitionIds] });
    },
  );
}
