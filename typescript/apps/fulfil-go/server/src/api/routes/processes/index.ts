/**
 * POST /processes/fulfilment — the fulfilment process manager's single
 * inbound webhook. One platform subscription binds every pick event type
 * PLUS the fulfilment's own `created` event onto it (dataOnly: the body is
 * the event's `data`; metadata rides x-fc-* headers).
 *
 * The route is SHARED INFRASTRUCTURE (docs/process-definitions.md): it
 * authenticates the delivery, normalizes the payload, reads the
 * fulfilment's OWNERSHIP STAMP and dispatches to that PROCESS DEFINITION
 * in the registry — the definition maps event → context command.
 *
 * Delivery semantics: the platform retries on non-2xx. Idempotent replays
 * and stale/out-of-order events surface as business_rule / not_found
 * failures — ACKED with 200 {handled:false} so retries stop (and recorded
 * in the activity log); anything else 500s for a retry.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { STANDARD_PROCESS_DEFINITION } from '@fulfil-go/shared';
import { isFailure, runJob, type Result } from '@fulfil-go/framework';
import { isFulfilmentId } from '../../../domain/fulfilments/ids.js';
import type { AppContext } from '../../../app-context.js';
import type { ProcessDefinition } from '../../../processes/process-registry.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';

const PROCESS_IDENTITY = { principalId: 'fulfil-go:process:fulfilment' } as const;

export interface RegisterProcessRoutesOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
}

export function registerProcessRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterProcessRoutesOptions,
): void {
  const authHook = flowcatalystWebhookAuthHook(options.webhookAuth);
  const registry = appContext.processRegistry;
  const supported = registry.supportedEventTypes();

  fastify.post(
    '/processes/fulfilment',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Processes'],
        // The Go platform's dataOnly delivery can arrive as a JSON STRING
        // containing the document (payload stored double-encoded) — accept
        // both shapes and normalise in the handler.
        body: Type.Union([Type.Object({}, { additionalProperties: true }), Type.String()]),
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
      // The Go platform's dispatcher sends `X-Event-Type` (processing.go);
      // `x-fc-event-type` kept for parity with the Rust-era convention.
      const header = request.headers['x-event-type'] ?? request.headers['x-fc-event-type'];
      const eventType = typeof header === 'string' ? header : header?.[0];
      if (!eventType || !supported.includes(eventType)) {
        return reply.code(400).send({
          error: 'UNSUPPORTED_EVENT_TYPE',
          message: `No registered definition handles '${eventType ?? '(missing)'}'. Supported: ${supported.join(', ')}.`,
        });
      }

      // Normalise the possibly string-encoded delivery body.
      let payload: unknown = request.body;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return reply
            .code(400)
            .send({ error: 'INVALID_PAYLOAD', message: 'Body is not valid JSON.' });
        }
      }

      // Every subscribed event carries the chain root — it's how we find
      // the stamp. A payload without it is malformed, not retryable.
      const ref = payload as { clientId?: string; fulfilmentId?: string };
      if (!ref.clientId || !ref.fulfilmentId || !isFulfilmentId(ref.fulfilmentId)) {
        return reply.code(400).send({
          error: 'INVALID_PAYLOAD',
          message: 'Payload must carry clientId and a well-formed fulfilmentId.',
        });
      }
      const { clientId, fulfilmentId } = ref;

      // OWNERSHIP STAMP → definition. Missing fulfilment falls through to
      // 'standard', whose deciders return the not_found the route ACKs.
      const stamp =
        (await appContext.repositories.fulfilments.getProcessDefinition(
          clientId,
          fulfilmentId,
        )) ?? STANDARD_PROCESS_DEFINITION;
      let definition: ProcessDefinition;
      try {
        definition = registry.resolve(stamp);
      } catch (err) {
        // A stamped definition with no module is a deploy/config error —
        // 500 keeps the platform retrying while it gets fixed.
        request.log.error({ err, stamp, fulfilmentId }, 'unknown process definition stamp');
        return reply.code(500).send({
          error: 'UNKNOWN_PROCESS_DEFINITION',
          message: `No registered process definition '${stamp}'.`,
        });
      }

      const result = await runJob(
        { name: `fulfilment-process:${definition.code}`, identity: PROCESS_IDENTITY },
        (): Promise<Result<unknown>> =>
          appContext.runWrite(() =>
            definition.handle(
              { eventType, clientId, fulfilmentId, payload },
              appContext.useCases,
            ),
          ),
      );

      if (isFailure(result)) {
        // Replays / out-of-order / unknown refs: ack so the platform stops
        // retrying — the state machine already reflects (or superseded) it.
        if (result.error.type === 'business_rule' || result.error.type === 'not_found') {
          request.log.info(
            { eventType, code: result.error.code },
            'process event acked without action',
          );
          // Log the NON-event too (docs/activity-log.md): the decider's tx
          // rolled back, so this receipt is a detached best-effort append —
          // the debugging gold is usually in what was IGNORED and why.
          await appContext.repositories.activityLog.appendDetached({
            clientId,
            fulfilmentId,
            subjectType: 'fulfilment',
            subjectId: fulfilmentId,
            source: 'platform',
            actor: PROCESS_IDENTITY.principalId,
            category: 'webhook',
            message: `Delivery of ${eventType} ACKed without action: ${result.error.code}.`,
            data: { eventType, code: result.error.code, message: result.error.message },
          });
          return reply.code(200).send({ handled: false, note: result.error.code });
        }
        request.log.error({ eventType, error: result.error }, 'process event failed');
        return reply.code(500).send({ error: result.error.code, message: result.error.message });
      }

      return reply.code(200).send({ handled: true });
    },
  );
}
