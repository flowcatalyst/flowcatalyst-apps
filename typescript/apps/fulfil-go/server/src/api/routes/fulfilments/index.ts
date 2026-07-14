import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@fulfil-go/framework';
import {
  CancelFulfilmentCommandSchema,
  CreateFulfilmentCommandSchema,
  CreateFulfilmentResponseSchema,
  FulfilGoPermission,
  FulfilmentDtoSchema,
  HandoverPinsSchema,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { asFulfilmentId } from '../../../domain/fulfilments/ids.js';
import { toFulfilmentDto } from '../../../domain/fulfilments/fulfilment-dto.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseSchema, UnauthorizedSchema, WRITE_RESPONSES } from '../../schemas/common.js';

/**
 * Tenant-scoped fulfilment routes (pinpoint convention: clientId in the
 * path, injected into the command; per-client claim enforcement is a scope
 * concern parked with the tenancy plumbing).
 */
export function registerFulfilmentRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/clients/:clientId/fulfilments',
    {
      schema: {
        tags: ['Fulfilments'],
        summary: 'Create a fulfilment',
        description:
          'Idempotent on (client, externalSource, externalRef) — a duplicate returns ' +
          'FULFILMENT_ALREADY_EXISTS with the existing id. Fulfilments are immutable after ' +
          'creation (cancel-only). Body contract: CreateFulfilmentCommand (Zod, validated ' +
          'in-handler; the synced OpenAPI catalogue carries the derived JSON schema).',
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Any(),
        response: {
          201: CreateFulfilmentResponseSchema,
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const parsed = CreateFulfilmentCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: (request.params as { clientId: string }).clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.createFulfilment.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      appContext.sseBroker.nudge();

      const data = result.value.event.getData();
      return reply.code(201).send({
        fulfilmentId: data.fulfilmentId,
        parts: data.parts,
        // Pins ride the CREATE RESPONSE only (upstream pulls and messages
        // the customer) — never events, never list/detail DTOs.
        handover: {
          deliveryPin: result.value.handover.deliveryPin,
          pickupPins: [...result.value.handover.pickupPins],
        },
        createdAt: result.value.event.time.toISOString(),
      });
    },
  );

  fastify.post(
    '/clients/:clientId/fulfilments/:fulfilmentId/cancel',
    {
      schema: {
        tags: ['Fulfilments'],
        summary: 'Cancel a fulfilment',
        description:
          'Only fulfilments still in `created` cancel directly; picking work in flight goes ' +
          'through the process manager. Optimistic-locked (409 on concurrent transition).',
        params: Type.Object({ clientId: Type.String(), fulfilmentId: Type.String() }),
        body: Type.Optional(Type.Object({ reason: Type.Optional(Type.String()) })),
        response: {
          200: Type.Object({ fulfilmentId: Type.String(), status: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { clientId: string; fulfilmentId: string };
      const parsed = CancelFulfilmentCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: params.clientId,
        fulfilmentId: params.fulfilmentId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.cancelFulfilment.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      appContext.sseBroker.nudge();

      return reply
        .code(200)
        .send({ fulfilmentId: result.value.getData().fulfilmentId, status: 'cancelled' });
    },
  );

  fastify.get(
    '/clients/:clientId/fulfilments',
    {
      schema: {
        tags: ['Fulfilments'],
        summary: 'List fulfilments',
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          /** Comma-separated storeRefs — fulfilments with any part at any of them. */
          stores: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({ fulfilments: Type.Array(FulfilmentDtoSchema) }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const { limit, offset, stores } = request.query as {
        limit?: number;
        offset?: number;
        stores?: string;
      };
      const storeRefs = stores
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const rows = await appContext.repositories.fulfilments.listByClient(
        clientId,
        limit ?? 50,
        offset ?? 0,
        storeRefs,
      );
      return reply.code(200).send({ fulfilments: rows.map(toFulfilmentDto) });
    },
  );

  fastify.get(
    '/clients/:clientId/fulfilments/:fulfilmentId/activity-log',
    {
      schema: {
        tags: ['Fulfilments'],
        summary: 'Fulfilment activity log (the chain record)',
        params: Type.Object({ clientId: Type.String(), fulfilmentId: Type.String() }),
        response: {
          200: Type.Object({
            entries: Type.Array(
              Type.Object({
                id: Type.Number(),
                at: Type.String(),
                subjectType: Type.String(),
                subjectId: Type.String(),
                source: Type.String(),
                actor: Type.String(),
                category: Type.String(),
                message: Type.String(),
                data: Type.Union([Type.Any(), Type.Null()]),
              }),
            ),
          }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { fulfilmentId } = request.params as { clientId: string; fulfilmentId: string };
      const entries = await appContext.repositories.activityLog.listByFulfilment(fulfilmentId);
      return reply.code(200).send({
        entries: entries.map((e) => ({
          id: e.id,
          at: e.at.toISOString(),
          subjectType: e.subjectType,
          subjectId: e.subjectId,
          source: e.source,
          actor: e.actor,
          category: e.category,
          message: e.message,
          data: e.data ?? null,
        })),
      });
    },
  );

  fastify.get(
    '/clients/:clientId/fulfilments/:fulfilmentId',
    {
      schema: {
        tags: ['Fulfilments'],
        summary: 'Get a fulfilment',
        params: Type.Object({ clientId: Type.String(), fulfilmentId: Type.String() }),
        response: {
          200: FulfilmentDtoSchema,
          401: UnauthorizedSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, fulfilmentId } = request.params as {
        clientId: string;
        fulfilmentId: string;
      };
      const fulfilment = await appContext.repositories.fulfilments.findById(
        clientId,
        asFulfilmentId(fulfilmentId),
      );
      if (!fulfilment) {
        return reply.code(404).send({
          error: 'not_found',
          code: 'FULFILMENT_NOT_FOUND',
          message: `Fulfilment '${fulfilmentId}' does not exist for this client.`,
          details: null,
        });
      }
      return reply.code(200).send(toFulfilmentDto(fulfilment));
    },
  );

  fastify.get(
    '/clients/:clientId/fulfilments/:fulfilmentId/handover-pins',
    {
      schema: {
        tags: ['Fulfilments'],
        summary: 'Reveal handover PINs (audited)',
        description:
          'EVERY grant of this read writes a pin-viewed activity-log entry BEFORE the pins ' +
          'are returned (audit-before-disclose). Management principals (viewHandoverPins) see ' +
          'everything; picker sessions see only the pickup pins for parts at their store.',
        params: Type.Object({ clientId: Type.String(), fulfilmentId: Type.String() }),
        response: {
          200: Type.Composite([Type.Object({ fulfilmentId: Type.String() }), HandoverPinsSchema]),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, fulfilmentId } = request.params as {
        clientId: string;
        fulfilmentId: string;
      };

      const managerGrant = scope.permissions.has(FulfilGoPermission.ViewHandoverPins);
      // Picker sessions may read THEIR store's pickup pins (the staff member
      // reading the pin out to a driver who can't scan).
      const pickerStoreRef =
        !managerGrant &&
        scope.permissions.has(FulfilGoPermission.ViewStorePicks) &&
        scope.attributes['clientId'] === clientId
          ? scope.attributes['storeRef']
          : undefined;
      if (!managerGrant && !pickerStoreRef) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'PERMISSION_DENIED',
          message: 'Revealing handover pins requires viewHandoverPins or a picker session.',
          details: null,
        });
      }

      const fulfilment = await appContext.repositories.fulfilments.findById(
        clientId,
        asFulfilmentId(fulfilmentId),
      );
      if (!fulfilment) {
        return reply.code(404).send({
          error: 'not_found',
          code: 'FULFILMENT_NOT_FOUND',
          message: `Fulfilment '${fulfilmentId}' does not exist for this client.`,
          details: null,
        });
      }

      const parts = fulfilment.parts.filter(
        (p) => p.pickupPin !== null && (!pickerStoreRef || p.origin.ref === pickerStoreRef),
      );

      // Audit BEFORE disclose — if this write fails, the reveal fails.
      await appContext.repositories.activityLog.appendAudited({
        clientId,
        fulfilmentId: fulfilment.id,
        subjectType: 'fulfilment',
        subjectId: fulfilment.id,
        source: 'admin',
        actor: scope.principalId,
        category: 'pin-viewed',
        message: pickerStoreRef
          ? `Pickup pin(s) viewed by store ${pickerStoreRef} staff.`
          : 'Handover pins viewed from management.',
        data: {
          surface: pickerStoreRef ? 'picking-app' : 'management',
          partIds: parts.map((p) => p.id),
          deliveryPinIncluded: !pickerStoreRef && fulfilment.deliveryPin !== null,
        },
      });

      return reply.code(200).send({
        fulfilmentId: fulfilment.id,
        deliveryPin: pickerStoreRef ? null : fulfilment.deliveryPin,
        pickupPins: parts.map((p) => ({
          partId: p.id,
          shortId: p.shortId,
          originRef: p.origin.ref,
          pin: p.pickupPin as string,
        })),
      });
    },
  );
}
