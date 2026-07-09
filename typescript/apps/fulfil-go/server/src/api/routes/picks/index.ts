/**
 * POST /clients/:clientId/picks — the create-pick dispatch job's target.
 *
 * PICK CONTEXT LANDING PAD: the real pick context replaces this handler.
 * For now it proves the full platform loop (release sweep → outbox dispatch
 * job → platform dispatcher → HMAC-signed POST back here) by acknowledging
 * the command and recording receipt on the fulfilment's processing log.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { TransactionStore } from '@fulfil-go/framework';
import type { AppContext } from '../../../app-context.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';

export interface RegisterPickRoutesOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
}

export function registerPickRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterPickRoutesOptions,
): void {
  const authHook = flowcatalystWebhookAuthHook(options.webhookAuth);

  fastify.post(
    '/clients/:clientId/picks',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Jobs'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: Type.Object({ accepted: Type.Boolean() }),
          401: Type.Object({
            error: Type.Object({
              type: Type.String(),
              code: Type.String(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        clientId?: string;
        fulfilmentId?: string;
        partId?: string;
        shortId?: string;
      };
      request.log.info(
        { fulfilmentId: body.fulfilmentId, partId: body.partId },
        'create-pick received (pick context landing pad)',
      );
      if (body.clientId && body.fulfilmentId) {
        // Record receipt on the fulfilment's timeline — observability only.
        await appContext.transactionManager.inTransaction((tx) =>
          TransactionStore.run(tx, () =>
            appContext.repositories.fulfilmentLog.append({
              clientId: body.clientId!,
              fulfilmentId: body.fulfilmentId!,
              actor: 'fulfil-go:system:pick-landing-pad',
              category: 'pick-release',
              message: `create-pick for part #${body.shortId ?? body.partId} delivered (pick context not yet implemented).`,
              data: { partId: body.partId ?? null },
            }),
          ),
        );
      }
      return reply.code(200).send({ accepted: true });
    },
  );
}
