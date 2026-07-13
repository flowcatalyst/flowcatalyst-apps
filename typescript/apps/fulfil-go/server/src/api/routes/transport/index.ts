/**
 * Transport routes:
 *
 * - GET  /clients/:id/transport/orders — management list (scope-authed).
 * - POST /clients/:id/transport/orders/:orderId/book — the BOOK dispatch
 *   job's target (HMAC platform webhook): provider-planned booking, walks
 *   the candidate chain. ACK-on-state-guard, 500-for-retry.
 * - POST /transport/webhooks/uber — Uber Direct callbacks (x-uber-signature
 *   over the RAW body). Forward-only status application; stale/unknown ACK
 *   with 200 so Uber stops retrying.
 * - EPOD claim surface stubs (the planning context fills them in).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure, runJob, type Result } from '@fulfil-go/framework';
import type { AppContext } from '../../../app-context.js';
import { isTransportOrderId } from '../../../domain/transport-orders/ids.js';
import { toStatusUpdate, verifyUberSignature } from '../../../transport/uber/webhook.js';
import type { UberWebhookEvent } from '../../../transport/uber/types.js';
import {
  flowcatalystWebhookAuthHook,
  type WebhookAuthHookOptions,
} from '../../plugins/flowcatalyst-webhook-auth.js';

const TRANSPORT_IDENTITY = { principalId: 'fulfil-go:transport:system' } as const;

/** A vehicle with no fix inside this window renders as inactive. */
const ACTIVE_POSITION_WINDOW_MS = 10 * 60 * 1000;

const ClaimableTripsRequestSchema = Type.Object({
  /** EPOD driver reference (e.g. 'CS001') — bound to the offer, not the claim. */
  driverReference: Type.String({ minLength: 1 }),
  /** EPOD vehicle registration — capacity limits constrain the offer. */
  vehicleRegistration: Type.String({ minLength: 1 }),
  /** EPOD depot reference → collection store. */
  depotReference: Type.Optional(Type.String()),
  /** Territory fallback when no single depot. */
  territoryReference: Type.Optional(Type.String()),
  /** Restrict the offer to one order/part reference. */
  orderReference: Type.Optional(Type.String()),
});

const UnauthorizedSchema = Type.Object({ error: Type.String(), message: Type.String() });

const TransportOrderDtoSchema = Type.Object({
  id: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  status: Type.String(),
  serviceLevel: Type.String(),
  originRef: Type.String(),
  destination: Type.Any(),
  slotStart: Type.String(),
  slotEnd: Type.String(),
  parcels: Type.Array(Type.Any()),
  requiresVehicle: Type.Boolean(),
  provider: Type.String(),
  providerRef: Type.Union([Type.String(), Type.Null()]),
  trackingUrl: Type.Union([Type.String(), Type.Null()]),
  courier: Type.Union([Type.Any(), Type.Null()]),
  failureReason: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export interface RegisterTransportRoutesOptions {
  readonly webhookAuth: WebhookAuthHookOptions;
  /** Uber Direct webhook signing key — unset in dev skips verification LOUDLY. */
  readonly uberWebhookSecret: string | undefined;
}

export function registerTransportRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  options: RegisterTransportRoutesOptions,
): void {
  const authHook = flowcatalystWebhookAuthHook(options.webhookAuth);
  let warnedUnsignedUber = false;

  fastify.get(
    '/clients/:clientId/transport/orders',
    {
      schema: {
        tags: ['Transport'],
        summary: 'List transport orders',
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          statuses: Type.Optional(Type.String({ description: 'Comma-separated status filter' })),
        }),
        response: {
          200: Type.Object({ orders: Type.Array(TransportOrderDtoSchema) }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const { limit, offset, statuses } = request.query as {
        limit?: number;
        offset?: number;
        statuses?: string;
      };
      const statusFilter = statuses
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const orders = await appContext.repositories.transportOrders.listByClient(
        clientId,
        limit ?? 50,
        offset ?? 0,
        statusFilter,
      );
      return reply.send({
        orders: orders.map((o) => ({
          id: o.id,
          fulfilmentId: o.fulfilmentId,
          partId: o.partId,
          shortId: o.shortId,
          status: o.status,
          serviceLevel: o.serviceLevel,
          originRef: o.originRef,
          destination: o.destination,
          slotStart: o.window.slotStart.toISOString(),
          slotEnd: o.window.slotEnd.toISOString(),
          parcels: [...o.parcels],
          requiresVehicle: o.requiresVehicle,
          provider: o.provider,
          providerRef: o.providerRef,
          trackingUrl: o.trackingUrl,
          courier: o.courier,
          failureReason: o.failureReason,
          createdAt: o.createdAt.toISOString(),
          updatedAt: o.updatedAt.toISOString(),
        })),
      });
    },
  );

  fastify.get(
    '/clients/:clientId/transport/positions',
    {
      schema: {
        tags: ['Transport'],
        summary: 'Latest vehicle positions (the map read model)',
        description:
          'One entry per vehicle across execution systems (own app drivers, Uber couriers, ' +
          'EPOD drivers when that channel lands). `active` = a fix within the last 10 minutes.',
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: Type.Object({
            vehicles: Type.Array(
              Type.Object({
                executionSystem: Type.String(),
                vehicleRef: Type.String(),
                label: Type.Union([Type.String(), Type.Null()]),
                lat: Type.Number(),
                lng: Type.Number(),
                heading: Type.Union([Type.Number(), Type.Null()]),
                speed: Type.Union([Type.Number(), Type.Null()]),
                recordedAt: Type.String(),
                active: Type.Boolean(),
                tripRef: Type.Union([Type.String(), Type.Null()]),
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
      const { clientId } = request.params as { clientId: string };
      const rows = await appContext.repositories.transportPositions.listForClient(clientId);
      const activeCutoff = Date.now() - ACTIVE_POSITION_WINDOW_MS;
      return reply.send({
        vehicles: rows.map((r) => ({
          executionSystem: r.executionSystem,
          vehicleRef: r.vehicleRef,
          label: r.label,
          lat: r.lat,
          lng: r.lng,
          heading: r.heading,
          speed: r.speed,
          recordedAt: r.recordedAt.toISOString(),
          active: r.recordedAt.getTime() >= activeCutoff,
          tripRef: r.tripRef,
        })),
      });
    },
  );

  fastify.post(
    '/clients/:clientId/transport/orders/:orderId/book',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Transport'],
        summary: 'Book a provider-planned transport order (platform dispatch target)',
        params: Type.Object({ clientId: Type.String(), orderId: Type.String() }),
        body: Type.Union([Type.Object({}, { additionalProperties: true }), Type.String()]),
        response: {
          200: Type.Object({ handled: Type.Boolean(), note: Type.Optional(Type.String()) }),
          400: Type.Object({ error: Type.String(), message: Type.String() }),
          500: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { clientId, orderId } = request.params as { clientId: string; orderId: string };
      if (!isTransportOrderId(orderId)) {
        return reply
          .code(400)
          .send({ error: 'INVALID_ORDER_ID', message: `'${orderId}' is not a transport order.` });
      }
      let result: Result<unknown>;
      try {
        result = await runJob(
          { name: 'book-transport-order', identity: TRANSPORT_IDENTITY },
          // The use case manages its own tx boundaries — provider HTTP
          // must run outside any db tx.
          () =>
            appContext.useCases.bookTransportOrder.execute({
              clientId,
              transportOrderId: orderId,
            }),
        );
      } catch (err) {
        request.log.error({ err, orderId }, 'transport booking failed');
        return reply
          .code(500)
          .send({ error: 'BOOKING_FAILED', message: 'Provider call failed — retry.' });
      }
      if (isFailure(result)) {
        if (result.error.type === 'business_rule' || result.error.type === 'not_found') {
          return reply.code(200).send({ handled: false, note: result.error.code });
        }
        request.log.error({ orderId, error: result.error }, 'transport booking failed');
        return reply.code(500).send({ error: result.error.code, message: result.error.message });
      }
      return reply.code(200).send({ handled: true });
    },
  );

  fastify.post(
    '/transport/webhooks/uber',
    {
      schema: {
        tags: ['Transport'],
        summary: 'Uber Direct status webhook',
        body: Type.Object({}, { additionalProperties: true }),
        response: {
          200: Type.Object({ handled: Type.Boolean(), note: Type.Optional(Type.String()) }),
          401: UnauthorizedSchema,
          500: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      // Signature over the RAW body (captured by the content-type parser).
      const signatureHeader = request.headers['x-uber-signature'];
      const signature =
        typeof signatureHeader === 'string' ? signatureHeader : signatureHeader?.[0];
      if (options.uberWebhookSecret) {
        if (
          !signature ||
          !request.rawBody ||
          !verifyUberSignature(request.rawBody, signature, options.uberWebhookSecret)
        ) {
          return reply
            .code(401)
            .send({ error: 'unauthorized', message: 'Invalid or missing x-uber-signature.' });
        }
      } else if (!warnedUnsignedUber) {
        warnedUnsignedUber = true;
        request.log.warn(
          'FULFILGO_UBER_WEBHOOK_SECRET is unset — accepting UNSIGNED Uber webhooks (dev only).',
        );
      }

      const event = request.body as UberWebhookEvent;
      if (!event.delivery_id || !event.data) {
        return reply.code(200).send({ handled: false, note: 'NOT_A_DELIVERY_EVENT' });
      }
      const update = toStatusUpdate(event);

      // Vehicle-map read model — courier_update fires every 20s once
      // assigned and is usually a STALE status (ACKed below), so the
      // position upsert happens FIRST, unconditionally.
      const courierGeo = update.courierLocation ?? update.delivery.courier?.location;
      if (courierGeo) {
        const order = await appContext.repositories.transportOrders.findByProviderRef(
          'uber',
          update.providerRef,
        );
        await appContext.repositories.transportPositions.upsertLatest({
          clientId: order?.clientId ?? null,
          executionSystem: 'uber',
          vehicleRef: update.providerRef,
          label: update.delivery.courier?.name ?? null,
          lat: courierGeo.lat,
          lng: courierGeo.lng,
          recordedAt: new Date(),
          tripRef: order?.id ?? null,
          meta: update.delivery.courier?.vehicleType
            ? { vehicleType: update.delivery.courier.vehicleType }
            : null,
        });
      }

      const result = await runJob(
        { name: 'uber-webhook', identity: TRANSPORT_IDENTITY },
        (): Promise<Result<unknown>> =>
          appContext.runWrite(() =>
            appContext.useCases.applyTransportStatus.execute({
              provider: 'uber',
              providerRef: update.providerRef,
              status: update.delivery.status,
              courier: update.delivery.courier
                ? {
                    name: update.delivery.courier.name ?? null,
                    vehicleType: update.delivery.courier.vehicleType ?? null,
                    phone: update.delivery.courier.phone ?? null,
                  }
                : null,
              trackingUrl: update.delivery.trackingUrl ?? null,
              failureReason:
                update.delivery.status === 'failed' ? 'provider reported failure/return' : null,
              raw: { kind: update.kind, status: event.data.status, liveMode: update.liveMode },
            }),
          ),
      );

      if (isFailure(result)) {
        // Stale/out-of-order (courier_update spam, replays) and unknown refs
        // (other environment, return legs): ACK — Uber must not retry these.
        if (result.error.type === 'business_rule' || result.error.type === 'not_found') {
          return reply.code(200).send({ handled: false, note: result.error.code });
        }
        request.log.error({ error: result.error }, 'uber webhook failed');
        return reply.code(500).send({ error: result.error.code, message: result.error.message });
      }
      return reply.code(200).send({ handled: true });
    },
  );

  // ── EPOD claim surface (STUBS — the planning context fills these in) ────

  fastify.post(
    '/clients/:clientId/transport/epod/claimable-trips',
    {
      schema: {
        tags: ['Transport'],
        summary: 'EPOD claim surface: request an offer of claimable trips (STUB)',
        description:
          'Stub until the transport planning context lands — always returns an empty offer ' +
          "list. Integral's claim proxy calls this with the driver/vehicle/depot context; " +
          'the planning context will answer with a reserved offer group.',
        params: Type.Object({ clientId: Type.String() }),
        body: ClaimableTripsRequestSchema,
        response: {
          200: Type.Object({ offers: Type.Array(Type.Unknown()) }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (_request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      // TODO(transport-planning): build a reserved offer (driver+vehicle
      // bound now, expiring hold on the trip/orders) instead of nothing.
      return reply.code(200).send({ offers: [] });
    },
  );

  fastify.post(
    '/clients/:clientId/transport/epod/claims/:groupId',
    {
      schema: {
        tags: ['Transport'],
        summary: 'EPOD claim surface: claim an offered trip group (STUB)',
        description:
          'Stub until the transport planning context lands — no offers exist, so every ' +
          'claim is 410 gone. The real implementation confirms the reservation and ' +
          'synchronously pushes the route plan to EPOD (explicit accept/reject).',
        params: Type.Object({ clientId: Type.String(), groupId: Type.String() }),
        response: {
          401: UnauthorizedSchema,
          410: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (_request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      return reply.code(410).send({
        error: 'gone',
        message: 'No such offer — transport planning context not yet live.',
      });
    },
  );
}
