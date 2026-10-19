import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import { BFF_SURFACE, CANONICAL_SURFACE } from './access.js';
import { registerGetRequestLogRoute } from './get-request-log.route.js';
import { registerListRequestLogsRoute } from './list-request-logs.route.js';
import { registerUsageReportRoute } from './usage-report.route.js';

/** Reporting on the canonical API and, for the SPA's usage page, the BFF. */
export function registerReportingRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  for (const surface of [CANONICAL_SURFACE, BFF_SURFACE]) {
    registerUsageReportRoute(fastify, appContext, surface);
    registerListRequestLogsRoute(fastify, appContext, surface);
    registerGetRequestLogRoute(fastify, appContext, surface);
  }
}
