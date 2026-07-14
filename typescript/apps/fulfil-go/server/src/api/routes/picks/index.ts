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
import {
  CompletePickCommandSchema,
  CreatePickRequestSchema,
  FailPickCommandSchema,
  FulfilGoPermission,
  PickDtoSchema,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { toPickDto } from '../../../domain/picks/pick-dto.js';
import type { PickStatus } from '../../../domain/picks/pick.js';
import { PickShortPicked } from '../../../domain/picks/events/pick-outcome.events.js';
import { sendUseCaseError, useCaseErrorOutcome } from '../../plugins/error-mapper.js';
import { withIdempotency } from '../../plugins/idempotency.js';
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

  // Admin/back-office pick listing across stores (platform-OIDC, NOT picker
  // sessions) — feeds the management app's Requested/Active views. Enriched
  // with picker display names so the UI doesn't show raw pkr_ ids.
  fastify.get(
    '/clients/:clientId/picks/admin',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({
          status: Type.Optional(
            Type.Union([
              Type.Literal('requested'),
              Type.Literal('claimed'),
              Type.Literal('picked'),
              Type.Literal('short_picked'),
              Type.Literal('failed'),
            ]),
          ),
          store: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            picks: Type.Array(PickDtoSchema),
            pickers: Type.Record(Type.String(), Type.String()),
          }),
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
      if (!scope.permissions.has(FulfilGoPermission.ManagePickers)) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'PERMISSION_DENIED',
          message: `Missing permission ${FulfilGoPermission.ManagePickers}.`,
          details: null,
        });
      }
      const { clientId } = request.params as { clientId: string };
      const { status, store } = request.query as { status?: PickStatus; store?: string };
      const rows = await appContext.repositories.picks.listByClient(clientId, {
        ...(status ? { status } : {}),
        ...(store ? { storeRef: store } : {}),
      });

      const pickerIds = [
        ...new Set(rows.map((p) => p.claimedBy).filter((id): id is string => !!id)),
      ];
      const pickerRows = await appContext.repositories.pickerUsers.findByIds(clientId, pickerIds);
      const pickers = Object.fromEntries(pickerRows.map((p) => [p.id, p.displayName]));

      return reply.code(200).send({ picks: rows.map(toPickDto), pickers });
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
            Type.Union([
              Type.Literal('requested'),
              Type.Literal('claimed'),
              Type.Literal('picked'),
              Type.Literal('short_picked'),
              Type.Literal('failed'),
            ]),
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

  // Station-facing resolved PICK settings for the session's store: the bag
  // catalog + construction mapping drive the packing drawer (loose
  // auto-size, construction chip, oversize sanity check) — resolved LIVE,
  // while COMPLETION stamps the values that actually shipped.
  fastify.get(
    '/clients/:clientId/pick-station-settings',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: Type.Object({
            storeRef: Type.String(),
            bagSpecs: Type.Any(),
            constructionByTemperature: Type.Any(),
            pickSortAlgorithm: Type.String(),
          }),
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
      const { clientId } = request.params as { clientId: string };
      if (!storeRef || scope.attributes['clientId'] !== clientId) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'NOT_A_PICKER_SESSION',
          message: 'Station settings require a store-bound picker session.',
          details: null,
        });
      }
      const settings = await appContext.pickSettingsForStore(clientId, storeRef);
      return reply.code(200).send({
        storeRef,
        bagSpecs: settings.bagSpecs,
        constructionByTemperature: settings.constructionByTemperature,
        pickSortAlgorithm: settings.pickSortAlgorithm,
      });
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

  // SUPERVISOR: flag a pick as needing a CAR OR BIGGER (no bike/scooter).
  // Settable anytime the pick isn't failed/cancelled; a supervisor 'true'
  // survives the picker's completion answer.
  fastify.post(
    '/clients/:clientId/picks/:pickId/car-flag',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String(), pickId: Type.String() }),
        body: Type.Object(
          { requiresCarOrLarger: Type.Boolean() },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ pickId: Type.String(), requiresCarOrLarger: Type.Boolean() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, pickId } = request.params as { clientId: string; pickId: string };
      const { requiresCarOrLarger } = request.body as { requiresCarOrLarger: boolean };
      const result = await appContext.runWrite(() =>
        appContext.useCases.flagPickVehicle.execute({ clientId, pickId, requiresCarOrLarger }),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      appContext.sseBroker.nudge();

      return reply.code(200).send({
        pickId: result.value.getData().pickId,
        requiresCarOrLarger: result.value.getData().requiresCarOrLarger,
      });
    },
  );

  // Complete a claimed pick with per-line picked quantities (claimer only).
  // Short quantities are rejected when the pick requires a full pick.
  fastify.post(
    '/clients/:clientId/picks/:pickId/complete',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String(), pickId: Type.String() }),
        body: Type.Any(),
        response: {
          200: Type.Object({ pickId: Type.String(), status: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { clientId: string; pickId: string };
      const parsed = CompletePickCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: params.clientId,
        pickId: params.pickId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      // Offline-queue replays carry an Idempotency-Key — a retry after a
      // lost response replays the stored outcome instead of 409ing.
      return withIdempotency(appContext.repositories.idempotency, request, reply, async () => {
        const result = await appContext.runWrite(() =>
          appContext.useCases.completePick.execute(parsed.data),
        );
        if (isFailure(result)) return useCaseErrorOutcome(result.error);
        appContext.sseBroker.nudge();
        const status = result.value instanceof PickShortPicked ? 'short_picked' : 'picked';
        return { status: 200, body: { pickId: result.value.getData().pickId, status } };
      });
    },
  );

  fastify.post(
    '/clients/:clientId/picks/:pickId/fail',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String(), pickId: Type.String() }),
        body: Type.Any(),
        response: {
          200: Type.Object({ pickId: Type.String(), status: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { clientId: string; pickId: string };
      const parsed = FailPickCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: params.clientId,
        pickId: params.pickId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      return withIdempotency(appContext.repositories.idempotency, request, reply, async () => {
        const result = await appContext.runWrite(() =>
          appContext.useCases.failPick.execute(parsed.data),
        );
        if (isFailure(result)) return useCaseErrorOutcome(result.error);
        appContext.sseBroker.nudge();
        return { status: 200, body: { pickId: result.value.getData().pickId, status: 'failed' } };
      });
    },
  );
}
