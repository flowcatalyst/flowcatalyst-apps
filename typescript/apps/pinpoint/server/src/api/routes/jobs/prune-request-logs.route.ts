/**
 * POST /jobs/prune-request-logs — webhook the FlowCatalyst platform's
 * scheduled-job runner calls once a day. Deletes `request_logs` rows older
 * than the retention window (`PINPOINT_REQUEST_LOG_RETENTION_DAYS`, default
 * 400 — a full year of monthly reports plus margin).
 *
 * HMAC-verified like every job webhook (see validate-master-locations.route.ts
 * for why jobs build their own scope inside `runJob`).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { runJob } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';
import { SystemIdentity } from '../../../scheduling/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const PruneResponseSchema = Type.Object({
  cutoff: Type.String({ format: 'date-time' }),
  deleted: Type.Integer({ minimum: 0 }),
});

const JobErrorSchema = Type.Object({
  error: Type.Object({ type: Type.String(), code: Type.String(), message: Type.String() }),
});

export interface RegisterPruneRequestLogsRouteOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
  readonly retentionDays: number;
}

export function registerPruneRequestLogsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterPruneRequestLogsRouteOptions,
): void {
  fastify.post(
    '/jobs/prune-request-logs',
    {
      preHandler: [flowcatalystWebhookAuthHook(options.webhookAuth)],
      schema: {
        operationId: 'pruneRequestLogs',
        tags: ['Jobs'],
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: PruneResponseSchema,
          401: JobErrorSchema,
          415: JobErrorSchema,
          500: JobErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      const cutoff = new Date(Date.now() - options.retentionDays * DAY_MS);
      const deleted = await runJob(
        { name: 'pinpoint-prune-request-logs', identity: SystemIdentity.SCHEDULER },
        () => appContext.repositories.requestLogs.pruneBefore(cutoff),
      );
      return reply.code(200).send({ cutoff: cutoff.toISOString(), deleted });
    },
  );
}
