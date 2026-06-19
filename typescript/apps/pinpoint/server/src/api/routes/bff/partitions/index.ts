import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../../app-context.js';
import { registerBffListPartitionsRoute } from './list-partitions.route.js';
import { registerBffGetPartitionRoute } from './get-partition.route.js';
import { registerBffCreatePartitionRoute } from './create-partition.route.js';
import { registerBffUpdatePartitionRoute } from './update-partition.route.js';
import { registerBffDeletePartitionRoute } from './delete-partition.route.js';

export function registerBffPartitionRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerBffListPartitionsRoute(fastify, appContext);
  registerBffGetPartitionRoute(fastify, appContext);
  registerBffCreatePartitionRoute(fastify, appContext);
  registerBffUpdatePartitionRoute(fastify, appContext);
  registerBffDeletePartitionRoute(fastify, appContext);
}
