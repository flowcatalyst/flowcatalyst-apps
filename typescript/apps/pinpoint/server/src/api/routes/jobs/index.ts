import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../../app-context.js';
import type { WebhookAuthHookOptions } from '../../plugins/flowcatalyst-webhook-auth.js';
import { registerPruneRequestLogsRoute } from './prune-request-logs.route.js';
import { registerValidateMasterLocationsRoute } from './validate-master-locations.route.js';

export interface RegisterJobsRoutesOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
  /** Days of `request_logs` the prune job keeps. */
  readonly requestLogRetentionDays: number;
}

export function registerJobsRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterJobsRoutesOptions,
): void {
  registerValidateMasterLocationsRoute(fastify, appContext, { webhookAuth: options.webhookAuth });
  registerPruneRequestLogsRoute(fastify, appContext, {
    webhookAuth: options.webhookAuth,
    retentionDays: options.requestLogRetentionDays,
  });
}
