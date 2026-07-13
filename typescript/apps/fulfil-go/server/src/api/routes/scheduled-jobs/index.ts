/**
 * POST /jobs/release-picks — webhook the FlowCatalyst platform's scheduled-
 * job runner calls every minute (definition in flowcatalyst/scheduled-jobs).
 *
 * HMAC verification via `flowcatalystWebhookAuthHook` as the preHandler
 * (dev-mode bypass with a warning when FLOWCATALYST_SIGNING_SECRET is
 * unset). Identity is the SCHEDULER service scope via `runJob` — the global
 * onRequest scope hook doesn't fire for platform-signed webhooks.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { runJob } from '@fulfil-go/framework';
import type { AppContext } from '../../../app-context.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';
import { runReleasePicksSweep, SystemIdentity } from '../../../scheduling/release-picks.js';
import { runTransportReactionsSweep } from '../../../scheduling/transport-reactions.js';

const SweepResponseSchema = Type.Object({
  attempted: Type.Integer({ minimum: 0 }),
  released: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  failures: Type.Array(Type.Object({ partId: Type.String(), error: Type.String() })),
});

const WebhookErrorSchema = Type.Object({
  error: Type.Object({
    type: Type.String(),
    code: Type.String(),
    message: Type.String(),
  }),
});

export interface RegisterScheduledJobRoutesOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
}

export function registerScheduledJobRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterScheduledJobRoutesOptions,
): void {
  const authHook = flowcatalystWebhookAuthHook(options.webhookAuth);

  fastify.post(
    '/jobs/release-picks',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Jobs'],
        // The platform's runner sends `{}` by default; accept extra fields.
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: SweepResponseSchema,
          401: WebhookErrorSchema,
          500: WebhookErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await runJob(
        { name: 'fulfil-go-release-picks', identity: SystemIdentity.SCHEDULER },
        () => runReleasePicksSweep(appContext),
      );
      return reply.code(200).send(result);
    },
  );

  fastify.post(
    '/jobs/run-transport-reactions',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Jobs'],
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: Type.Object({
            attempted: Type.Integer({ minimum: 0 }),
            executed: Type.Integer({ minimum: 0 }),
            skipped: Type.Integer({ minimum: 0 }),
            failed: Type.Integer({ minimum: 0 }),
            failures: Type.Array(Type.Object({ reactionId: Type.String(), error: Type.String() })),
          }),
          401: WebhookErrorSchema,
          500: WebhookErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await runJob(
        { name: 'fulfil-go-transport-reactions', identity: SystemIdentity.SCHEDULER },
        () => runTransportReactionsSweep(appContext),
      );
      return reply.code(200).send(result);
    },
  );
}
