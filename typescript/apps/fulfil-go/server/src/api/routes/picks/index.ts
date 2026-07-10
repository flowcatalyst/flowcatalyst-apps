/**
 * Pick context routes.
 *
 * POST /clients/:clientId/picks — the create-pick dispatch job's target
 * (release sweep → outbox dispatch job → platform dispatcher → HMAC-signed
 * POST here). Persists the Pick via ReceivePickUseCase under a SERVICE scope;
 * duplicates ack 200 (the dispatcher retries on non-2xx).
 *
 * GET /picks + POST /picks/:pickId/claim — picker-facing, store-scoped from
 * the picker session token's attributes.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure, runJob } from '@fulfil-go/framework';
import { CreatePickRequestSchema, FulfilGoPermission, PickDtoSchema } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { toPickDto } from '../../../domain/picks/pick-dto.js';
import type { PickStatus } from '../../../domain/picks/pick.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';
import { ErrorResponseSchema, UnauthorizedSchema, WRITE_RESPONSES } from '../../schemas/common.js';

export interface RegisterPickRoutesOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
}

const PICK_INTAKE_IDENTITY = { principalId: 'fulfil-go:system:pick-intake' } as const;

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
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: Type.Object({
            accepted: Type.Boolean(),
            pickId: Type.Union([Type.String(), Type.Null()]),
          }),
          400: ErrorResponseSchema,
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
      const parsed = CreatePickRequestSchema.safeParse({
        ...(request.body as object | null),
        clientId: (request.params as { clientId: string }).clientId,
      });
      if (!parsed.success) {
        // A malformed command is OUR contract bug (the payload is machine-
        // hydrated) — 400 so the dispatcher parks it as failed, loudly.
        request.log.error({ issues: parsed.error.issues }, 'create-pick payload invalid');
        return reply.code(400).send({
          error: 'validation',
          code: 'CREATE_PICK_INVALID',
          message: 'create-pick payload failed validation.',
          details: parsed.error.issues,
        });
      }

      const result = await runJob({ name: 'pick-intake', identity: PICK_INTAKE_IDENTITY }, () =>
        appContext.runWrite(() => appContext.useCases.receivePick.execute(parsed.data)),
      );

      if (isFailure(result)) {
        // Idempotent replay — already registered, ack so the dispatcher stops.
        if (result.error.code === 'PICK_ALREADY_EXISTS') {
          const existingId = (result.error.details as { pickId?: string } | null)?.pickId ?? null;
          return reply.code(200).send({ accepted: true, pickId: existingId });
        }
        return sendUseCaseError(reply, result.error);
      }

      appContext.sseBroker.nudge();
      request.log.info(
        { pickId: result.value.getData().pickId, partId: parsed.data.partId },
        'create-pick registered',
      );
      return reply.code(200).send({ accepted: true, pickId: result.value.getData().pickId });
    },
  );

  // Store-scoped pick list for the signed-in picker (storeRef from the
  // session token — there is no way to ask for another store's picks).
  fastify.get(
    '/clients/:clientId/picks',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({
          status: Type.Optional(
            Type.Union([Type.Literal('requested'), Type.Literal('claimed')]),
          ),
        }),
        response: {
          200: Type.Object({ picks: Type.Array(PickDtoSchema) }),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const storeRef = scope.attributes['storeRef'];
      const scopeClientId = scope.attributes['clientId'];
      const { clientId } = request.params as { clientId: string };
      if (
        !storeRef ||
        scopeClientId !== clientId ||
        !scope.permissions.has(FulfilGoPermission.ViewStorePicks)
      ) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'NOT_A_PICKER_SESSION',
          message: 'Listing picks requires a picker session scoped to this client.',
          details: null,
        });
      }
      const { status } = request.query as { status?: PickStatus };
      const rows = await appContext.repositories.picks.listByStore(clientId, storeRef, status);
      return reply.code(200).send({ picks: rows.map(toPickDto) });
    },
  );

  fastify.post(
    '/clients/:clientId/picks/:pickId/claim',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String(), pickId: Type.String() }),
        response: {
          200: Type.Object({ pickId: Type.String(), status: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, pickId } = request.params as { clientId: string; pickId: string };
      const result = await appContext.runWrite(() =>
        appContext.useCases.claimPick.execute({ clientId, pickId }),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      appContext.sseBroker.nudge();

      return reply.code(200).send({ pickId: result.value.getData().pickId, status: 'claimed' });
    },
  );
}
