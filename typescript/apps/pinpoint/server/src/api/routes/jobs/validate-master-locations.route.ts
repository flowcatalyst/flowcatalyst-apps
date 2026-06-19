/**
 * POST /jobs/validate-master-locations — webhook the FlowCatalyst
 * platform's scheduled-job runner calls every 5 minutes.
 *
 * Each firing drains the current GEOCODED master_locations backlog,
 * running `confirm-master-location` on each. The platform's
 * `concurrent: false` flag means only one firing runs at a time;
 * `tracksCompletion: false` makes this fire-and-forget (response body
 * is for the platform's instance-log surface only).
 *
 * HMAC verification via `flowcatalystWebhookAuthHook` as the
 * `preHandler`. Identity for the work is `SystemIdentity.SCHEDULER`,
 * propagated through `runJob(...)` so the underlying use cases and
 * outbox writes see a `Scope` with the scheduler principal.
 *
 * Standalone webhook plugin scope — the global `onRequest` Scope hook
 * in `server.ts` only kicks in when the request carries an OIDC token
 * (or the dev `x-user-id` header), neither of which a platform-signed
 * webhook will. We construct a SERVICE-identity Scope inside `runJob`
 * directly.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { runJob } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';
import { runValidateMasterLocationsBatch, SystemIdentity } from '../../../scheduling/index.js';

const BatchResponseSchema = Type.Object({
  attempted: Type.Integer({ minimum: 0 }),
  confirmed: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  failures: Type.Array(
    Type.Object({
      masterLocationId: Type.String(),
      error: Type.String(),
    }),
  ),
});

const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    type: Type.String(),
    code: Type.String(),
    message: Type.String(),
  }),
});

export interface RegisterValidateMasterLocationsRouteOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
}

export function registerValidateMasterLocationsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterValidateMasterLocationsRouteOptions,
): void {
  const authHook = flowcatalystWebhookAuthHook(options.webhookAuth);

  fastify.post(
    '/jobs/validate-master-locations',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Jobs'],
        // The platform's scheduled-job runner sends `{}` by default — the
        // job's `payload` field on the platform side is empty. Accept any
        // object so future payload fields don't 415.
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: BatchResponseSchema,
          401: ErrorResponseSchema,
          415: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await runJob(
        { name: 'pinpoint-validate-master-locations', identity: SystemIdentity.SCHEDULER },
        () => runValidateMasterLocationsBatch(appContext),
      );
      return reply.code(200).send(result);
    },
  );
}
