/**
 * Store registry routes (platform-OIDC admins). Reference data, not a domain
 * aggregate — sync is a plain idempotent upsert, so the permission check
 * lives here at the route (there's no use case to carry it).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import { FulfilGoPermission, SyncStoresCommandSchema } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { BadRequestSchema, ErrorResponseSchema, UnauthorizedSchema } from '../../schemas/common.js';

const StoreSummarySchema = Type.Object({
  id: Type.String(),
  storeRef: Type.String(),
  name: Type.String(),
  city: Type.Union([Type.String(), Type.Null()]),
  region: Type.Union([Type.String(), Type.Null()]),
});

export function registerStoreRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.put(
    '/clients/:clientId/stores',
    {
      schema: {
        tags: ['Stores'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Any(),
        response: {
          200: Type.Object({ synced: Type.Integer() }),
          400: BadRequestSchema,
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      if (!scope.permissions.has(FulfilGoPermission.ManageStores)) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'PERMISSION_DENIED',
          message: `Missing permission ${FulfilGoPermission.ManageStores}.`,
          details: null,
        });
      }
      const parsed = SyncStoresCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: (request.params as { clientId: string }).clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const synced = await appContext.repositories.stores.upsertMany(
        parsed.data.clientId,
        parsed.data.stores,
      );
      return reply.code(200).send({ synced });
    },
  );

  fastify.get(
    '/clients/:clientId/stores',
    {
      schema: {
        tags: ['Stores'],
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: Type.Object({ stores: Type.Array(StoreSummarySchema) }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const rows = await appContext.repositories.stores.listByClient(clientId);
      return reply.code(200).send({ stores: [...rows] });
    },
  );
}
