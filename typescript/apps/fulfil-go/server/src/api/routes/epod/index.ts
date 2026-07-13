/**
 * EPOD provisioning landing pad.
 *
 * POST /clients/:clientId/epod/provision — the epod-provision dispatch
 * job's target (fulfilment PM decider → outbox dispatch job → platform
 * dispatcher → HMAC-signed POST here). Pushes the fulfilment's delivery
 * destination + products to EPOD's upsert endpoints (idempotent on their
 * side — replays converge). Payload: {fulfilmentId}.
 *
 * Delivery semantics: 200 ACKs stop the dispatcher (including not-found /
 * dev-skip replays); EPOD/API failures 500 so the platform retries.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { runJob } from '@fulfil-go/framework';
import type { AppContext } from '../../../app-context.js';
import { isFulfilmentId } from '../../../domain/fulfilments/ids.js';
import { EpodApiError } from '../../../transport/epod/client.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';

const EPOD_PROVISION_IDENTITY = { principalId: 'fulfil-go:system:epod-provision' } as const;

export interface RegisterEpodRoutesOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
}

export function registerEpodRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterEpodRoutesOptions,
): void {
  const authHook = flowcatalystWebhookAuthHook(options.webhookAuth);

  fastify.post(
    '/clients/:clientId/epod/provision',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Transport'],
        summary: 'EPOD master-data provisioning (dispatch-job target)',
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: Type.Object({
            handled: Type.Boolean(),
            note: Type.Optional(Type.String()),
          }),
          400: Type.Object({ error: Type.String(), message: Type.String() }),
          401: Type.Object({
            error: Type.Object({
              type: Type.String(),
              code: Type.String(),
              message: Type.String(),
            }),
          }),
          500: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const fulfilmentId = (request.body as { fulfilmentId?: unknown } | null)?.fulfilmentId;
      if (typeof fulfilmentId !== 'string' || !isFulfilmentId(fulfilmentId)) {
        // Machine-hydrated payload — malformed means OUR contract bug; 400
        // parks the dispatch job as failed, loudly (same stance as create-pick).
        request.log.error({ fulfilmentId }, 'epod-provision payload invalid');
        return reply.code(400).send({
          error: 'EPOD_PROVISION_INVALID',
          message: 'epod-provision payload requires a fulfilmentId.',
        });
      }

      try {
        const outcome = await runJob(
          { name: 'epod-provision', identity: EPOD_PROVISION_IDENTITY },
          () => appContext.useCases.provisionEpod.execute({ clientId, fulfilmentId }),
        );

        switch (outcome.kind) {
          case 'provisioned':
            request.log.info({ fulfilmentId, outcome }, 'epod provisioning completed');
            return reply.code(200).send({ handled: true });
          case 'skipped':
            request.log.warn({ fulfilmentId, reason: outcome.reason }, 'epod provisioning skipped');
            return reply.code(200).send({ handled: false, note: outcome.reason });
          case 'not_found':
            // ACK — retrying a truly unknown fulfilment never converges.
            request.log.warn({ fulfilmentId }, 'epod provisioning for unknown fulfilment');
            return reply.code(200).send({ handled: false, note: 'FULFILMENT_NOT_FOUND' });
        }
      } catch (err) {
        // EPOD/API/network failure — 500 so the platform retries the job.
        request.log.error({ err, fulfilmentId }, 'epod provisioning failed');
        const message = err instanceof EpodApiError ? err.message : 'EPOD provisioning failed.';
        return reply.code(500).send({ error: 'EPOD_PROVISION_FAILED', message });
      }
    },
  );
}
