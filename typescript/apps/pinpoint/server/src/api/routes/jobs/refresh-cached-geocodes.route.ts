/**
 * POST /jobs/refresh-cached-geocodes — webhook the FlowCatalyst platform's
 * scheduled-job runner calls once a day. Renews master locations' cached
 * Google Maps geocodes before their 30 days run out, and deletes any that
 * expired without a renewal (see `scheduling/refresh-cached-geocodes.ts`).
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
import { runRefreshCachedGeocodesBatch, SystemIdentity } from '../../../scheduling/index.js';

const RefreshResponseSchema = Type.Object({
  attempted: Type.Integer({ minimum: 0 }),
  refreshed: Type.Integer({ minimum: 0 }),
  expired: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  failures: Type.Array(Type.Object({ masterLocationId: Type.String(), error: Type.String() })),
});

const JobErrorSchema = Type.Object({
  error: Type.Object({ type: Type.String(), code: Type.String(), message: Type.String() }),
});

export function registerRefreshCachedGeocodesRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: { readonly webhookAuth: WebhookAuthHookOptions },
): void {
  fastify.post(
    '/jobs/refresh-cached-geocodes',
    {
      preHandler: [flowcatalystWebhookAuthHook(options.webhookAuth)],
      schema: {
        operationId: 'refreshCachedGeocodes',
        tags: ['Jobs'],
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: RefreshResponseSchema,
          401: JobErrorSchema,
          415: JobErrorSchema,
          500: JobErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await runJob(
        { name: 'pinpoint-refresh-cached-geocodes', identity: SystemIdentity.SCHEDULER },
        () => runRefreshCachedGeocodesBatch(appContext),
      );
      return reply.code(200).send(result);
    },
  );
}
