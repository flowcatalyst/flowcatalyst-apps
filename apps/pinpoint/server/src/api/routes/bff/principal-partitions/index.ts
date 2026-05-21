import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListPrincipalsForPartitionRoute } from './list-principals.route.js';
import { registerBffGrantPartitionAccessRoute } from './grant-access.route.js';
import { registerBffRevokePartitionAccessRoute } from './revoke-access.route.js';

export function registerBffPrincipalPartitionRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  registerBffListPrincipalsForPartitionRoute(fastify, appContext);
  registerBffGrantPartitionAccessRoute(fastify, appContext);
  registerBffRevokePartitionAccessRoute(fastify, appContext);
}
