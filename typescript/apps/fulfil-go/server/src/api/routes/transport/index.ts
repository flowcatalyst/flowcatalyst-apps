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
 * - The claim MARKETPLACE (transport planning context) — ONE offer/claim
 *   surface, two doors: /transport/epod/* is what Integral's claim proxy
 *   calls (driver context from their app; response mapped by their
 *   FulfilGoClaimClient), /transport/offers* is the same thing for our
 *   execution app (driver = the authenticated principal).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ScopeStore, isFailure, runJob, type Result } from '@fulfil-go/framework';
import type { AppContext } from '../../../app-context.js';
import { isTransportOrderId } from '../../../domain/transport-orders/ids.js';
import { asDriverUserId, isDriverUserId } from '../../../domain/driver-identity/ids.js';
import {
  OFFER_GONE,
  TRIP_ALREADY_CLAIMED,
} from '../../../operations/transport-planning/claim-transport-trip.use-case.js';
import type {
  ClaimTripResult,
  ComposeOfferResult,
} from '../../../operations/transport-planning/offer-types.js';
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
  requiresCarOrLarger: Type.Boolean(),
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
          requiresCarOrLarger: o.requiresCarOrLarger,
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
    '/clients/:clientId/transport/trips',
    {
      schema: {
        tags: ['Transport'],
        summary: 'List planned trips (the claim marketplace record)',
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          statuses: Type.Optional(Type.String({ description: 'Comma-separated status filter' })),
        }),
        response: {
          200: Type.Object({
            trips: Type.Array(
              Type.Object({
                id: Type.String(),
                status: Type.String(),
                provider: Type.String(),
                originRef: Type.String(),
                driverRef: Type.String(),
                vehicleRef: Type.String(),
                anchorOrderId: Type.Union([Type.String(), Type.Null()]),
                stops: Type.Array(
                  Type.Object({
                    orderId: Type.String(),
                    shortId: Type.String(),
                    legKm: Type.Union([Type.Number(), Type.Null()]),
                    legMinutes: Type.Union([Type.Number(), Type.Null()]),
                  }),
                ),
                offerExpiresAt: Type.String(),
                routeKm: Type.Union([Type.Number(), Type.Null()]),
                routeMinutes: Type.Union([Type.Number(), Type.Null()]),
                failureReason: Type.Union([Type.String(), Type.Null()]),
                createdAt: Type.String(),
                updatedAt: Type.String(),
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
      const { limit, offset, statuses } = request.query as {
        limit?: number;
        offset?: number;
        statuses?: string;
      };
      const statusFilter = statuses
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const trips = await appContext.repositories.trips.listByClient(
        clientId,
        limit ?? 50,
        offset ?? 0,
        statusFilter,
      );
      return reply.send({
        trips: trips.map((t) => ({
          id: t.id,
          status: t.status,
          provider: t.provider,
          originRef: t.originRef,
          driverRef: t.driverRef,
          vehicleRef: t.vehicleRef,
          anchorOrderId: t.anchorOrderId,
          stops: t.stops.map((s) => ({
            orderId: s.orderId,
            shortId: s.shortId,
            legKm: s.legKm,
            legMinutes: s.legMinutes,
          })),
          offerExpiresAt: t.offerExpiresAt.toISOString(),
          routeKm: t.routeKm,
          routeMinutes: t.routeMinutes,
          failureReason: t.failureReason,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
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

  // ── The claim marketplace (transport planning context) ──────────────────

  const sendOfferResult = async (reply: FastifyReply, result: Result<ComposeOfferResult>) => {
    if (isFailure(result)) {
      if (result.error.type === 'business_rule' || result.error.type === 'not_found') {
        // Empty-offer outcomes (anchor unavailable, all candidates raced
        // away, …) — the driver flow renders "no orders found".
        return reply.code(200).send({ offers: [], reason: result.error.code });
      }
      return reply.code(500).send({ error: result.error.code, message: result.error.message });
    }
    return reply.code(200).send(result.value);
  };

  const sendClaimResult = async (reply: FastifyReply, result: Result<ClaimTripResult>) => {
    if (isFailure(result)) {
      if (result.error.code === TRIP_ALREADY_CLAIMED) {
        // Idempotent replay — same success shape the first claim returned.
        return reply.code(200).send(result.error.details);
      }
      if (result.error.code === OFFER_GONE || result.error.type === 'not_found') {
        return reply.code(410).send({ error: 'gone', message: result.error.message });
      }
      if (result.error.code === 'OPEN_TRIP_EXISTS') {
        // One active trip per driver — finish it first (Andrew, 2026-07-14).
        return reply.code(409).send({ error: result.error.code, message: result.error.message });
      }
      return reply.code(500).send({ error: result.error.code, message: result.error.message });
    }
    return reply.code(200).send(result.value);
  };

  fastify.post(
    '/clients/:clientId/transport/epod/claimable-trips',
    {
      schema: {
        tags: ['Transport'],
        summary: 'EPOD claim surface: compose + reserve a trip offer',
        description:
          "Integral's claim proxy calls this with the driver/vehicle/depot context. The " +
          'planning context composes a multi-stop trip (anchored on orderReference when ' +
          'given), reserves the whole group atomically (driver+vehicle bound NOW, expiring ' +
          'hold), and answers with the offer. Empty offers carry a `reason`.',
        params: Type.Object({ clientId: Type.String() }),
        body: ClaimableTripsRequestSchema,
        response: {
          200: Type.Object({
            offers: Type.Array(Type.Unknown()),
            reason: Type.Optional(Type.String()),
          }),
          401: UnauthorizedSchema,
          500: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        driverReference: string;
        vehicleRegistration: string;
        depotReference?: string;
        territoryReference?: string;
        orderReference?: string;
      };
      const result = await appContext.useCases.composeTransportOffer.execute({
        clientId,
        channel: 'epod',
        driverRef: body.driverReference,
        vehicleRef: body.vehicleRegistration,
        depotRef: body.depotReference ?? null,
        territoryRef: body.territoryReference ?? null,
        orderRef: body.orderReference ?? null,
      });
      return sendOfferResult(reply, result);
    },
  );

  fastify.post(
    '/clients/:clientId/transport/epod/claims/:groupId',
    {
      schema: {
        tags: ['Transport'],
        summary: 'EPOD claim surface: claim an offered trip group',
        description:
          'Confirms the reservation and SYNCHRONOUSLY pushes the route plan to EPOD ' +
          '(explicit accept/reject). Push rejection releases the whole group and answers ' +
          "410 — the proxy renders the driver app's offer-expired response.",
        params: Type.Object({ clientId: Type.String(), groupId: Type.String() }),
        body: Type.Object(
          {
            driverReference: Type.Optional(Type.String()),
            vehicleRegistration: Type.Optional(Type.String()),
          },
          { additionalProperties: true },
        ),
        response: {
          200: Type.Object({
            tripReference: Type.String(),
            orderReferences: Type.Array(Type.String()),
          }),
          401: UnauthorizedSchema,
          /** One active trip per driver (own channel) — finish it first. */
          409: Type.Object({ error: Type.String(), message: Type.String() }),
          410: Type.Object({ error: Type.String(), message: Type.String() }),
          500: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, groupId } = request.params as { clientId: string; groupId: string };
      const body = (request.body ?? {}) as { driverReference?: string };
      const result = await appContext.useCases.claimTransportTrip.execute({
        clientId,
        channel: 'epod',
        groupId,
        driverRef: body.driverReference ?? null,
      });
      return sendClaimResult(reply, result);
    },
  );

  // ── Native claim surface (our execution app — same marketplace) ─────────

  fastify.post(
    '/clients/:clientId/transport/offers',
    {
      schema: {
        tags: ['Transport'],
        summary: 'Compose + reserve a trip offer for the authenticated driver',
        description:
          'A DRIVER SESSION (staff code + PIN login) needs no body — the depot comes from ' +
          "the session and the vehicle/class default to the driver's registered ones. Other " +
          'principals (dev fallback, admins) must name a depot or pin a store.',
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Object({
          /** Depot whose stores feed the offer (driver sessions default to theirs). */
          depotRef: Type.Optional(Type.String({ minLength: 1 })),
          /** Pin ONE store instead of a depot (admin/dev flows). */
          storeRef: Type.Optional(Type.String({ minLength: 1 })),
          vehicleRef: Type.Optional(Type.String()),
          /** Anchor claim — driver-entered part reference. */
          orderReference: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            offers: Type.Array(Type.Unknown()),
            reason: Type.Optional(Type.String()),
          }),
          400: Type.Object({ error: Type.String(), message: Type.String() }),
          401: UnauthorizedSchema,
          500: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        depotRef?: string;
        storeRef?: string;
        vehicleRef?: string;
        orderReference?: string;
      };

      // Driver session: depot + default vehicle/class ride the identity.
      const driverRef = scope.attributes['driverRef'] ?? null;
      const depotRef = body.depotRef ?? (driverRef ? scope.attributes['depotRef'] : undefined);
      if (!depotRef && !body.storeRef) {
        return reply.code(400).send({
          error: 'DEPOT_OR_STORE_REQUIRED',
          message: 'depotRef (or storeRef) is required for this principal.',
        });
      }
      let vehicleRef = body.vehicleRef;
      let vehicleClass: string | null = null;
      if (driverRef && isDriverUserId(driverRef)) {
        const driver = await appContext.repositories.driverUsers.findById(
          clientId,
          asDriverUserId(driverRef),
        );
        vehicleRef ??= driver?.defaultVehicleReg ?? undefined;
        vehicleClass = driver?.defaultVehicleClass ?? null;
      }

      const result = await appContext.useCases.composeTransportOffer.execute({
        clientId,
        channel: 'own',
        driverRef: driverRef ?? scope.principalId,
        vehicleRef: vehicleRef ?? 'unspecified',
        depotRef: depotRef ?? null,
        storeRef: body.storeRef ?? null,
        orderRef: body.orderReference ?? null,
        vehicleClass,
      });
      return sendOfferResult(reply, result);
    },
  );

  // The driver's own trips — the Work tab's persistent state (a claimed
  // trip must survive app restarts; page-local state does not).
  fastify.get(
    '/clients/:clientId/transport/my-trips',
    {
      schema: {
        tags: ['Transport'],
        summary: "The authenticated driver's claimed trips (newest first)",
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        }),
        response: {
          200: Type.Object({ trips: Type.Array(Type.Unknown()) }),
          401: UnauthorizedSchema,
          403: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const driverRef = scope.attributes['driverRef'];
      if (!driverRef) {
        return reply
          .code(403)
          .send({ error: 'forbidden', message: 'This endpoint requires a driver session.' });
      }
      const { clientId } = request.params as { clientId: string };
      const { limit } = request.query as { limit?: number };
      const trips = await appContext.repositories.trips.listByDriver(
        clientId,
        driverRef,
        ['claimed'],
        limit ?? 5,
      );
      const orderIds = trips.flatMap((t) => [...t.orderIds]);
      const orders = await appContext.repositories.transportOrders.findManyByIds(
        clientId,
        orderIds,
      );
      const orderById = new Map<string, (typeof orders)[number]>(orders.map((o) => [o.id, o]));
      return reply.send({
        trips: trips.map((t) => ({
          tripId: t.id,
          originRef: t.originRef,
          claimedAt: t.updatedAt.toISOString(),
          routeKm: t.routeKm,
          routeMinutes: t.routeMinutes,
          stops: t.stops.map((s) => {
            const order = orderById.get(s.orderId);
            return {
              orderId: s.orderId,
              shortId: s.shortId,
              destination: s.destination,
              legKm: s.legKm,
              legMinutes: s.legMinutes,
              status: order?.status ?? 'assigned',
              // Everything the app needs to run collection + delivery
              // verification OFFLINE: parcel refs to scan-match and the
              // REQUIREMENTS (never pin values — server verifies).
              parcels: (order?.parcels ?? []).map((p) => ({
                ref: p.ref,
                kind: p.kind,
                size: p.size,
                temperature: p.temperature,
              })),
              verification: order?.verification
                ? {
                    requirements: order.verification.requirements,
                    collectionMethod: order.verification.collection?.method ?? null,
                    deliveryPinOutcome: order.verification.delivery?.pinOutcome ?? null,
                  }
                : null,
            };
          }),
        })),
      });
    },
  );

  // Driver status reporting (own-channel trips have no webhook source —
  // the driver IS the signal). Idempotent: replays/double-taps ACK 200.
  // Bodies carry HANDOVER EVIDENCE (docs/handover-verification.md) — the
  // app captures it offline-first; verification is deferred server-side.
  const evidenceBody = {
    reason: Type.Optional(Type.String({ maxLength: 300 })),
    /** Collection confirm method: 'scan' | 'pin' (absent = bulk). */
    method: Type.Optional(Type.Union([Type.Literal('scan'), Type.Literal('pin')])),
    scannedRefs: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 100 })),
    /** Entered pin (pickup override at collection; delivery pin at the door). */
    pinEntered: Type.Optional(Type.String({ maxLength: 8 })),
    /** Age-restricted delivery: how the age was checked. */
    ageCheck: Type.Optional(
      Type.Object(
        {
          method: Type.Union([Type.Literal('id-attestation'), Type.Literal('visual-override')]),
          docType: Type.Optional(Type.String({ maxLength: 40 })),
          /** Government-ID photo (blob ref) when the policy requires it. */
          idPhotoRef: Type.Optional(Type.String({ maxLength: 64 })),
        },
        { additionalProperties: false },
      ),
    ),
    /** Proof-of-delivery photo (blob ref, client-generated pod_…). */
    photoRef: Type.Optional(Type.String({ maxLength: 64 })),
    /** Customer signature image (blob ref, client-generated sig_…). */
    signatureRef: Type.Optional(Type.String({ maxLength: 64 })),
    /** The driver's "I've arrived" tap (ISO) — arrival-to-handover timing. */
    arrivedAt: Type.Optional(Type.String({ maxLength: 40 })),
  };
  const reportSchema = (withOrder: boolean) => ({
    tags: ['Transport'],
    params: withOrder
      ? Type.Object({ clientId: Type.String(), tripId: Type.String(), orderId: Type.String() })
      : Type.Object({ clientId: Type.String(), tripId: Type.String() }),
    body: Type.Object(evidenceBody, { additionalProperties: false }),
    response: {
      200: Type.Object({
        updatedOrders: Type.Array(Type.String()),
        allCollected: Type.Boolean(),
        tripCompleted: Type.Boolean(),
        pinOutcome: Type.Optional(Type.String()),
        note: Type.Optional(Type.String()),
      }),
      401: UnauthorizedSchema,
      403: Type.Object({ error: Type.String(), message: Type.String() }),
      404: Type.Object({ error: Type.String(), message: Type.String() }),
      500: Type.Object({ error: Type.String(), message: Type.String() }),
    },
  });

  const handleReport = async (
    request: FastifyRequest,
    reply: FastifyReply,
    action: 'collected' | 'delivered' | 'failed',
  ) => {
    const scope = ScopeStore.get();
    if (!scope) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    }
    const driverRef = scope.attributes['driverRef'];
    if (!driverRef) {
      return reply
        .code(403)
        .send({ error: 'forbidden', message: 'This endpoint requires a driver session.' });
    }
    const params = request.params as { clientId: string; tripId: string; orderId?: string };
    const body = (request.body ?? {}) as {
      reason?: string;
      method?: 'scan' | 'pin';
      scannedRefs?: string[];
      pinEntered?: string;
      ageCheck?: {
        method: 'id-attestation' | 'visual-override';
        docType?: string;
        idPhotoRef?: string;
      };
      photoRef?: string;
      signatureRef?: string;
      arrivedAt?: string;
    };
    const result = await appContext.runWrite(() =>
      appContext.useCases.reportTripProgress.execute({
        clientId: params.clientId,
        tripId: params.tripId,
        driverRef,
        action,
        orderId: params.orderId ?? null,
        reason: body.reason ?? null,
        evidence: {
          method: body.method ?? null,
          scannedRefs: body.scannedRefs ?? null,
          pinEntered: body.pinEntered ?? null,
          ageCheck: body.ageCheck ?? null,
          photoRef: body.photoRef ?? null,
          signatureRef: body.signatureRef ?? null,
          arrivedAt: body.arrivedAt ?? null,
        },
      }),
    );
    if (isFailure(result)) {
      if (result.error.code === 'ALREADY_REPORTED') {
        // Double-tap/replay — the state is already what the driver said.
        return reply.code(200).send({
          updatedOrders: [],
          allCollected: false,
          tripCompleted: false,
          note: result.error.code,
        });
      }
      if (result.error.type === 'not_found') {
        return reply.code(404).send({ error: result.error.code, message: result.error.message });
      }
      if (result.error.type === 'authorization') {
        return reply.code(403).send({ error: result.error.code, message: result.error.message });
      }
      return reply.code(500).send({ error: result.error.code, message: result.error.message });
    }
    return reply.code(200).send(result.value);
  };

  fastify.post(
    '/clients/:clientId/transport/my-trips/:tripId/collected',
    { schema: reportSchema(false) },
    (request, reply) => handleReport(request, reply, 'collected'),
  );
  // Per-stop collection confirm — the scan flow's primary endpoint.
  fastify.post(
    '/clients/:clientId/transport/my-trips/:tripId/stops/:orderId/collected',
    { schema: reportSchema(true) },
    (request, reply) => handleReport(request, reply, 'collected'),
  );
  fastify.post(
    '/clients/:clientId/transport/my-trips/:tripId/stops/:orderId/delivered',
    { schema: reportSchema(true) },
    (request, reply) => handleReport(request, reply, 'delivered'),
  );
  fastify.post(
    '/clients/:clientId/transport/my-trips/:tripId/stops/:orderId/failed',
    { schema: reportSchema(true) },
    (request, reply) => handleReport(request, reply, 'failed'),
  );

  // ── Proof-of-delivery photos (docs/handover-verification.md): refs are
  // CLIENT-GENERATED (pod_…) so the offline queue can reference a photo
  // before its upload drains — PUT is an idempotent upsert; the queued
  // photo drains BEFORE the delivered report (FIFO). Driver escorts the
  // upload; management views via the GET.
  fastify.put(
    '/clients/:clientId/pod-photos/:ref',
    {
      schema: {
        tags: ['Transport'],
        params: Type.Object({ clientId: Type.String(), ref: Type.String() }),
        body: Type.Object(
          {
            /** JPEG/PNG, base64 (no data: prefix). App compresses ≤~350KB. */
            imageBase64: Type.String({ maxLength: 700_000 }),
            contentType: Type.Union([Type.Literal('image/jpeg'), Type.Literal('image/png')]),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ photoRef: Type.String() }),
          400: Type.Object({ error: Type.String(), message: Type.String() }),
          401: UnauthorizedSchema,
          403: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      if (!scope.attributes['driverRef']) {
        return reply
          .code(403)
          .send({ error: 'forbidden', message: 'This endpoint requires a driver session.' });
      }
      const { clientId, ref } = request.params as { clientId: string; ref: string };
      if (!/^(pod|sig|id)_[A-Za-z0-9_-]{6,48}$/.test(ref)) {
        return reply
          .code(400)
          .send({ error: 'INVALID_REF', message: 'blob ref must match (pod|sig|id)_<id>.' });
      }
      const { imageBase64, contentType } = request.body as {
        imageBase64: string;
        contentType: string;
      };
      const bytes = Buffer.from(imageBase64, 'base64');
      if (bytes.length === 0) {
        return reply.code(400).send({ error: 'EMPTY_IMAGE', message: 'No image bytes.' });
      }
      await appContext.blobStore(clientId).put(ref, bytes, contentType);
      return reply.code(200).send({ photoRef: ref });
    },
  );

  fastify.get(
    '/clients/:clientId/pod-photos/:ref',
    {
      schema: {
        tags: ['Transport'],
        params: Type.Object({ clientId: Type.String(), ref: Type.String() }),
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, ref } = request.params as { clientId: string; ref: string };
      const blob = await appContext.blobStore(clientId).get(ref);
      if (!blob) {
        return reply.code(404).send({ error: 'not_found', message: 'No such photo.' });
      }
      return reply.header('content-type', blob.contentType).send(Buffer.from(blob.bytes));
    },
  );

  // ONLINE interactive pin check — the app pre-verifies BEFORE handover
  // when it has signal; offline it skips this and deferred verification
  // takes over on the queued report. In-memory attempt limiter: 5 tries
  // per (order, kind) per 10 minutes, then 429.
  const pinAttempts = new Map<string, { count: number; resetAt: number }>();
  fastify.post(
    '/clients/:clientId/transport/my-trips/:tripId/stops/:orderId/verify-pin',
    {
      schema: {
        tags: ['Transport'],
        params: Type.Object({
          clientId: Type.String(),
          tripId: Type.String(),
          orderId: Type.String(),
        }),
        body: Type.Object(
          {
            kind: Type.Union([Type.Literal('pickup'), Type.Literal('delivery')]),
            pin: Type.String({ minLength: 1, maxLength: 8 }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ verified: Type.Boolean() }),
          401: UnauthorizedSchema,
          403: Type.Object({ error: Type.String(), message: Type.String() }),
          404: Type.Object({ error: Type.String(), message: Type.String() }),
          422: Type.Object({ error: Type.String(), message: Type.String() }),
          429: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const driverRef = scope.attributes['driverRef'];
      if (!driverRef) {
        return reply
          .code(403)
          .send({ error: 'forbidden', message: 'This endpoint requires a driver session.' });
      }
      const params = request.params as { clientId: string; tripId: string; orderId: string };
      const body = request.body as { kind: 'pickup' | 'delivery'; pin: string };

      const key = `${params.orderId}:${body.kind}`;
      const nowMs = Date.now();
      const window = pinAttempts.get(key);
      const attempts = window && window.resetAt > nowMs ? window : { count: 0, resetAt: nowMs + 600_000 };
      if (attempts.count >= 5) {
        return reply
          .code(429)
          .send({ error: 'TOO_MANY_ATTEMPTS', message: 'Try again later or use the report flow.' });
      }

      const result = await appContext.useCases.verifyHandoverPin.execute({
        clientId: params.clientId,
        tripId: params.tripId,
        driverRef,
        orderId: params.orderId,
        kind: body.kind,
        pin: body.pin,
      });
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code, message: result.message });
      }
      if (!result.verified) {
        attempts.count += 1;
        pinAttempts.set(key, attempts);
      } else {
        pinAttempts.delete(key);
      }
      return reply.code(200).send({ verified: result.verified });
    },
  );

  fastify.post(
    '/clients/:clientId/transport/offers/:groupId/claim',
    {
      schema: {
        tags: ['Transport'],
        summary: 'Claim an offered trip (native — no route-plan push)',
        params: Type.Object({ clientId: Type.String(), groupId: Type.String() }),
        response: {
          200: Type.Object({
            tripReference: Type.String(),
            orderReferences: Type.Array(Type.String()),
          }),
          401: UnauthorizedSchema,
          /** One active trip per driver (own channel) — finish it first. */
          409: Type.Object({ error: Type.String(), message: Type.String() }),
          410: Type.Object({ error: Type.String(), message: Type.String() }),
          500: Type.Object({ error: Type.String(), message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, groupId } = request.params as { clientId: string; groupId: string };
      const result = await appContext.useCases.claimTransportTrip.execute({
        clientId,
        channel: 'own',
        groupId,
        driverRef: scope.principalId,
      });
      return sendClaimResult(reply, result);
    },
  );
}
