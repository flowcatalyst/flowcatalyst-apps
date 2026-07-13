/**
 * Claim an offered trip — the marketplace's commit step (docs/
 * transport-context.md "EPOD integration plan" + "Allocation strategies").
 *
 * NOT a single-tx use case (book-transport-order pattern): the EPOD route
 * plan is pushed SYNCHRONOUSLY between the guard reads and the booking tx,
 * so acceptance is an explicit success/failure signal:
 *
 *   1. Pool-read the trip; 'OFFER_GONE' guards (unknown/expired/released/
 *      claimed-by-another). A re-claim by the SAME driver replays the
 *      success response (idempotent — their proxy may retry).
 *   2. EPOD channel: build the route plan from the trip + member orders +
 *      fulfilment actuals and push it OUTSIDE any tx. Push failure ⇒
 *      release the whole group (driver sees "offer expired") — the orders
 *      return to the marketplace.
 *   3. One short tx: trip → claimed; every member order → assigned
 *      (booked+assigned collapse — the claimer was bound at offer time),
 *      providerRef = trip id; events + same-tx activity entries.
 *
 * `OFFER_GONE` maps to 410 at the route; the Integral proxy renders it as
 * the offer-expired response their driver app already understands.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  isFailure,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@fulfil-go/framework';
import type { Fulfilment } from '../../domain/fulfilments/fulfilment.js';
import { asFulfilmentId } from '../../domain/fulfilments/ids.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import { TransportOrderAssigned } from '../../domain/transport-orders/events/transport-order.events.js';
import type { TransportOrderRepository } from '../../domain/transport-orders/transport-order.repository.js';
import { Trip } from '../../domain/trips/trip.js';
import { isTripId, asTripId } from '../../domain/trips/ids.js';
import {
  TripClaimed,
  TripReleased,
  type TripEventData,
} from '../../domain/trips/events/trip.events.js';
import type { TripRepository } from '../../domain/trips/trip.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';
import { loadTransportSettingsResolver } from '../../infrastructure/store-settings-resolver.js';
import { EpodApiError, type EpodClient } from '../../transport/epod/client.js';
import {
  EPOD_PLAN_CONTEXT_DEFAULTS,
  toEpodRoutePlan,
  type EpodPlanContext,
} from '../../transport/epod/route-plan-mapper.js';
import type { ClaimTripResult } from './offer-types.js';

export interface ClaimTransportTripCommand {
  readonly clientId: string;
  readonly channel: 'own' | 'epod';
  readonly groupId: string;
  /** Defensive echo from the proxy — must match the offer binding when set. */
  readonly driverRef?: string | null;
}

type RunWrite = <A>(thunk: () => Promise<Result<A>>) => Promise<Result<A>>;

/** Route maps this code to 410 — the proxy's offer-expired rendering. */
export const OFFER_GONE = 'OFFER_GONE' as const;
/** Idempotent replay marker — route maps it to the 200 success shape. */
export const TRIP_ALREADY_CLAIMED = 'TRIP_ALREADY_CLAIMED' as const;

function gone(message: string): Result<never> {
  return Result.failure(UseCaseError.businessRule(OFFER_GONE, message));
}

function tripEventData(trip: Trip, reason?: string): TripEventData {
  return {
    tripId: trip.id,
    clientId: trip.clientId,
    originRef: trip.originRef,
    provider: trip.provider,
    driverRef: trip.driverRef,
    vehicleRef: trip.vehicleRef,
    transportOrderIds: [...trip.orderIds],
    partShortIds: trip.stops.map((s) => s.shortId),
    ...(reason !== undefined ? { reason } : {}),
  };
}

export interface ClaimTripEpodConfig {
  /** Our client code == their tenant code — the company fallback. */
  readonly tenantCode: string | null;
}

export class ClaimTransportTripUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly db: PostgresJsDatabase,
    private readonly trips: TripRepository,
    private readonly transportOrders: TransportOrderRepository,
    private readonly fulfilments: FulfilmentRepository,
    private readonly activityLog: ActivityLogRepository,
    private readonly epodClient: EpodClient | null,
    private readonly epodConfig: ClaimTripEpodConfig,
    private readonly runWrite: RunWrite,
  ) {}

  async execute(command: ClaimTransportTripCommand): Promise<Result<ClaimTripResult>> {
    const scope = ScopeStore.require();
    if (!isTripId(command.groupId)) return gone(`No such offer '${command.groupId}'.`);
    const trip = await this.trips.findById(command.clientId, asTripId(command.groupId));
    if (!trip) return gone(`No such offer '${command.groupId}'.`);

    if (trip.status === 'claimed') {
      // Idempotent replay for the binding's driver; anyone else gets gone.
      // Result.success is UoW-restricted (nothing committed on a replay), so
      // this travels as a business-rule failure the route maps to 200.
      if (!command.driverRef || command.driverRef === trip.driverRef) {
        return Result.failure(
          UseCaseError.businessRule(TRIP_ALREADY_CLAIMED, `Trip '${trip.id}' already claimed.`, {
            tripReference: trip.id,
            orderReferences: [...trip.orderIds],
          }),
        );
      }
      return gone(`Offer '${trip.id}' was claimed by another driver.`);
    }
    if (trip.status !== 'offered') return gone(`Offer '${trip.id}' is ${trip.status}.`);
    if (command.driverRef && command.driverRef !== trip.driverRef) {
      return gone(`Offer '${trip.id}' is bound to another driver.`);
    }

    const now = new Date();
    if (Trip.isExpired(trip, now)) {
      await this.releaseGroup(scope, trip, 'offer expired before claim', 'expired');
      return gone(`Offer '${trip.id}' expired.`);
    }

    // Member orders must still hold OUR reservation (same clock as the trip).
    const orders = await this.transportOrders.findManyByIds(command.clientId, [...trip.orderIds]);
    const held = orders.filter((o) => o.reservation?.tripId === trip.id);
    if (held.length !== trip.orderIds.length) {
      await this.releaseGroup(scope, trip, 'reservation lost before claim', 'released');
      return gone(`Offer '${trip.id}' is no longer intact.`);
    }

    // Fulfilments back the route plan's items/destination refs.
    const fulfilmentsById = new Map<string, Fulfilment>();
    for (const order of held) {
      if (!fulfilmentsById.has(order.fulfilmentId)) {
        const fulfilment = await this.fulfilments.findById(
          command.clientId,
          asFulfilmentId(order.fulfilmentId),
        );
        if (fulfilment) fulfilmentsById.set(order.fulfilmentId, fulfilment);
      }
    }

    // ── EPOD: synchronous route-plan push, OUTSIDE any tx ──────────────────
    if (command.channel === 'epod') {
      const pushed = await this.pushRoutePlan(scope, trip, held, fulfilmentsById);
      if (!pushed) {
        await this.releaseGroup(scope, trip, 'route-plan push rejected', 'released');
        return gone(`Offer '${trip.id}' could not be booked with EPOD.`);
      }
    }

    // ── Booking tx: trip claimed + every order assigned ────────────────────
    return this.runWrite(async () => {
      const freshTrip = await this.trips.findById(command.clientId, trip.id);
      if (!freshTrip || freshTrip.status !== 'offered') {
        return gone(`Offer '${trip.id}' moved on during claim.`);
      }
      const claimed = Trip.claim(freshTrip, now);
      const courier = { name: trip.driverRef, vehicleType: trip.vehicleRef, phone: null };

      for (const order of held) {
        const next = TransportOrder.claimByTrip(order, command.channel, trip.id, courier, now);
        await this.activityLog.append({
          clientId: next.clientId,
          fulfilmentId: next.fulfilmentId,
          subjectType: 'transport_order',
          subjectId: next.id,
          source: 'domain',
          actor: scope.principalId,
          category: 'transport',
          message: `Part #${next.shortId} assigned to driver '${trip.driverRef}' via trip ${trip.id} (${command.channel}).`,
          data: { tripId: trip.id, driverRef: trip.driverRef, vehicleRef: trip.vehicleRef },
        });
        const committed = await commitAggregate(
          this.uow,
          this.registry,
          next,
          new TransportOrderAssigned(scope, {
            transportOrderId: next.id,
            clientId: next.clientId,
            fulfilmentId: next.fulfilmentId,
            partId: next.partId,
            shortId: next.shortId,
            provider: command.channel,
            providerRef: trip.id,
          }),
          command,
        );
        if (isFailure(committed)) return committed;
      }

      const committed = await commitAggregate(
        this.uow,
        this.registry,
        claimed,
        new TripClaimed(scope, tripEventData(claimed)),
        command,
      );
      return Result.map(
        committed,
        (): ClaimTripResult => ({ tripReference: trip.id, orderReferences: [...trip.orderIds] }),
      );
    });
  }

  /** Free the group (expiry/lost-hold/push-rejection) in one short tx. */
  private async releaseGroup(
    scope: Scope,
    trip: Trip,
    reason: string,
    outcome: 'expired' | 'released',
  ): Promise<void> {
    await this.runWrite(async () => {
      const freshTrip = await this.trips.findById(trip.clientId, trip.id);
      if (!freshTrip || freshTrip.status !== 'offered') {
        // Already resolved by a racing caller — nothing to release. The
        // failure is swallowed here (release is best-effort bookkeeping).
        return Result.failure(UseCaseError.businessRule('TRIP_NOT_OFFERED', 'Nothing to release.'));
      }
      const now = new Date();
      const orders = await this.transportOrders.findManyByIds(trip.clientId, [...trip.orderIds]);
      for (const order of orders) {
        if (order.reservation?.tripId !== trip.id) continue;
        await this.transportOrders.persist(TransportOrder.releaseReservation(order, now));
      }
      const next =
        outcome === 'expired' ? Trip.expire(freshTrip, now) : Trip.release(freshTrip, reason, now);
      return commitAggregate(
        this.uow,
        this.registry,
        next,
        new TripReleased(scope, tripEventData(next, reason)),
        { tripId: trip.id, reason },
      );
    });
  }

  /** Build + push the plan; true = EPOD accepted (201 applied / 200 replay). */
  private async pushRoutePlan(
    scope: Scope,
    trip: Trip,
    orders: readonly TransportOrder[],
    fulfilmentsById: ReadonlyMap<string, Fulfilment>,
  ): Promise<boolean> {
    if (!this.epodClient) {
      await this.activityLog.appendDetached({
        clientId: trip.clientId,
        fulfilmentId: orders[0]?.fulfilmentId ?? trip.clientId,
        subjectType: 'trip',
        subjectId: trip.id,
        source: 'epod',
        actor: scope.principalId,
        category: 'provider-call',
        message: `EPOD route plan for trip ${trip.id} NOT sent — EPOD client unconfigured.`,
        data: null,
      });
      return false;
    }

    const resolver = await loadTransportSettingsResolver(this.db, trip.clientId, [trip.originRef]);
    const config =
      resolver.resolve(trip.originRef).transportProviders.find((p) => p.code === 'epod')?.config ??
      {};
    const str = (key: string, fallback: string): string =>
      typeof config[key] === 'string' && config[key] ? (config[key] as string) : fallback;
    const company = str('companyReference', this.epodConfig.tenantCode ?? 'FULFILGO');
    const context: EpodPlanContext = {
      companyReference: company,
      companyName: str('companyName', company),
      transporterReference: str(
        'transporterReference',
        EPOD_PLAN_CONTEXT_DEFAULTS.transporterReference,
      ),
      transporterName: str('transporterName', EPOD_PLAN_CONTEXT_DEFAULTS.transporterName),
      vehicleTypeReference: str(
        'vehicleTypeReference',
        EPOD_PLAN_CONTEXT_DEFAULTS.vehicleTypeReference,
      ),
      vehicleTypeName: str('vehicleTypeName', EPOD_PLAN_CONTEXT_DEFAULTS.vehicleTypeName),
      vehicleTypeMaxWeightKg: EPOD_PLAN_CONTEXT_DEFAULTS.vehicleTypeMaxWeightKg,
    };

    const plan = toEpodRoutePlan({
      trip,
      ordersById: new Map(orders.map((o) => [o.id, o])),
      fulfilmentsById,
      context,
      now: new Date(),
    });

    try {
      const response = await this.epodClient.sendRoutePlan(plan);
      await this.activityLog.appendDetached({
        clientId: trip.clientId,
        fulfilmentId: orders[0]?.fulfilmentId ?? trip.clientId,
        subjectType: 'trip',
        subjectId: trip.id,
        source: 'epod',
        actor: scope.principalId,
        category: 'provider-call',
        message: `EPOD accepted the route plan for trip ${trip.id}.`,
        data: { results: response.results ?? null },
      });
      return response.success !== false;
    } catch (err) {
      const detail =
        err instanceof EpodApiError
          ? { status: err.status, message: err.message, body: err.body ?? null }
          : { message: err instanceof Error ? err.message : String(err) };
      await this.activityLog.appendDetached({
        clientId: trip.clientId,
        fulfilmentId: orders[0]?.fulfilmentId ?? trip.clientId,
        subjectType: 'trip',
        subjectId: trip.id,
        source: 'epod',
        actor: scope.principalId,
        category: 'provider-call',
        message: `EPOD rejected the route plan for trip ${trip.id}.`,
        data: detail,
      });
      return false;
    }
  }
}
