import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerCreatePartitionRoute } from './create-partition.route.js';
import { registerGetPartitionRoute } from './get-partition.route.js';

export function registerPartitionRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerCreatePartitionRoute(fastify, appContext);
  registerGetPartitionRoute(fastify, appContext);
}
