/**
 * POST /processes/fulfilment — the fulfilment process manager's single
 * inbound webhook. One platform subscription binds every pick event type
 * onto it (dataOnly: the body is the event's `data`; metadata rides x-fc-*
 * headers); this route dispatches on `x-fc-event-type` to the decider use
 * cases in operations/fulfilment-pick-process.
 *
 * Delivery semantics: the platform retries on non-2xx. Idempotent replays
 * and stale/out-of-order events surface as business_rule / not_found
 * failures — ACKED with 200 {handled:false} so retries stop; anything else
 * 500s for a retry.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { isFailure, runJob, type Result } from '@fulfil-go/framework';
import type { PickClaimedData } from '../../../domain/picks/events/pick-claimed.event.js';
import type {
  PickFailedData,
  PickOutcomeData,
} from '../../../domain/picks/events/pick-outcome.events.js';
import type { AppContext } from '../../../app-context.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';

const PROCESS_IDENTITY = { principalId: 'fulfil-go:process:fulfilment' } as const;

const SUPPORTED = [
  'fulfil-go:pick:pick:claimed',
  'fulfil-go:pick:pick:picked',
  'fulfil-go:pick:pick:short-picked',
  'fulfil-go:pick:pick:failed',
] as const;
type SupportedEventType = (typeof SUPPORTED)[number];

export interface RegisterProcessRoutesOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
}

export function registerProcessRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterProcessRoutesOptions,
): void {
  const authHook = flowcatalystWebhookAuthHook(options.webhookAuth);

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
      if (!eventType || !SUPPORTED.includes(eventType as SupportedEventType)) {
        return reply.code(400).send({
          error: 'UNSUPPORTED_EVENT_TYPE',
          message: `Process does not handle '${eventType ?? '(missing)'}'. Supported: ${SUPPORTED.join(', ')}.`,
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

      const result = await runJob(
        { name: 'fulfilment-pick-process', identity: PROCESS_IDENTITY },
        (): Promise<Result<unknown>> =>
          appContext.runWrite(() => {
            switch (eventType as SupportedEventType) {
              case 'fulfil-go:pick:pick:claimed': {
                const data = payload as PickClaimedData;
                return appContext.useCases.registerPartPicking.execute({
                  clientId: data.clientId,
                  fulfilmentId: data.fulfilmentId,
                  partId: data.partId,
                  pickerId: data.pickerId,
                });
              }
              case 'fulfil-go:pick:pick:picked':
              case 'fulfil-go:pick:pick:short-picked': {
                const data = payload as PickOutcomeData;
                return appContext.useCases.registerPartPicked.execute({
                  clientId: data.clientId,
                  fulfilmentId: data.fulfilmentId,
                  partId: data.partId,
                  pickerId: data.pickerId,
                  short: eventType === 'fulfil-go:pick:pick:short-picked',
                  requiresVehicle: data.requiresVehicle ?? false,
                  lineResults: data.lineResults.map((r) => ({
                    externalLineRef: r.externalLineRef,
                    pickedQuantity: r.pickedQuantity,
                    ...(r.substitutions ? { substitutions: r.substitutions } : {}),
                  })),
                  packages: data.packages ?? [],
                });
              }
              case 'fulfil-go:pick:pick:failed': {
                const data = payload as PickFailedData;
                return appContext.useCases.registerPartFailed.execute({
                  clientId: data.clientId,
                  fulfilmentId: data.fulfilmentId,
                  partId: data.partId,
                  pickerId: data.pickerId,
                  reason: data.reason,
                });
              }
            }
          }),
      );

      if (isFailure(result)) {
        // Replays / out-of-order / unknown refs: ack so the platform stops
        // retrying — the state machine already reflects (or superseded) it.
        if (result.error.type === 'business_rule' || result.error.type === 'not_found') {
          request.log.info(
            { eventType, code: result.error.code },
            'process event acked without action',
          );
          return reply.code(200).send({ handled: false, note: result.error.code });
        }
        request.log.error({ eventType, error: result.error }, 'process event failed');
        return reply.code(500).send({ error: result.error.code, message: result.error.message });
      }

      return reply.code(200).send({ handled: true });
    },
  );
}
