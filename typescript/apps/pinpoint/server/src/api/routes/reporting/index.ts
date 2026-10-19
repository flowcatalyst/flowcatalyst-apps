import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { registerGetRequestLogRoute } from './get-request-log.route.js';
import { registerListRequestLogsRoute } from './list-request-logs.route.js';
import { registerUsageReportRoute } from './usage-report.route.js';

export function registerReportingRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  registerUsageReportRoute(fastify, appContext);
  registerListRequestLogsRoute(fastify, appContext);
  registerGetRequestLogRoute(fastify, appContext);
}
