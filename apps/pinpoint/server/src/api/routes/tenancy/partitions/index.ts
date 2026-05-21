import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerCreatePartitionRoute } from './create-partition.route.js';
import { registerDeletePartitionRoute } from './delete-partition.route.js';
import { registerGetPartitionRoute } from './get-partition.route.js';
import { registerListPartitionsRoute } from './list-partitions.route.js';
import { registerUpdatePartitionRoute } from './update-partition.route.js';

export function registerPartitionRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerCreatePartitionRoute(fastify, appContext);
  registerListPartitionsRoute(fastify, appContext);
  registerGetPartitionRoute(fastify, appContext);
  registerUpdatePartitionRoute(fastify, appContext);
  registerDeletePartitionRoute(fastify, appContext);
}
