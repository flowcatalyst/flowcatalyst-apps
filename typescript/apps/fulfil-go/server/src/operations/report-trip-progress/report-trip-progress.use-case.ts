/**
 * Driver status reporting for OWN-channel trips — the execution app's
 * counterpart of the provider webhooks (own-channel execution has no
 * webhook source; the driver IS the signal):
 *
 *   collected            — leaving the store: every member order advances
 *                          (whole-trip action; the driver loads everything)
 *   delivered / failed   — per stop (order), failure carries a reason
 *
 * Forward-only on the order machine (replays/double-taps surface as
 * business-rule failures the route ACKs). When the last member order
 * reaches a terminal status the TRIP completes — it leaves the driver's
 * "my trips" and the marketplace record closes.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  isFailure,
  type AggregateRegistryImpl,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { FulfilGoPermission } from '@fulfil-go/shared';
import { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import { TRANSPORT_ORDER_EVENT_BY_STATUS } from '../../domain/transport-orders/events/transport-order.events.js';
import type { TransportOrderRepository } from '../../domain/transport-orders/transport-order.repository.js';
import { Trip } from '../../domain/trips/trip.js';
import { asTripId, isTripId } from '../../domain/trips/ids.js';
import { TripCompleted } from '../../domain/trips/events/trip.events.js';
import type { TripRepository } from '../../domain/trips/trip.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';

export type TripProgressAction = 'collected' | 'delivered' | 'failed';

export interface ReportTripProgressCommand {
  readonly clientId: string;
  readonly tripId: string;
  /** The session's driver — must be the trip's claimer. */
  readonly driverRef: string;
  readonly action: TripProgressAction;
  /** Required for delivered/failed (per stop); ignored for collected. */
  readonly orderId?: string | null;
  readonly reason?: string | null;
}

export interface TripProgressOutcome {
  readonly updatedOrders: readonly string[];
  readonly tripCompleted: boolean;
}

export class ReportTripProgressUseCase {
  static readonly requiredPermission = FulfilGoPermission.ReportTransportOutcome;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly trips: TripRepository,
    private readonly transportOrders: TransportOrderRepository,
    private readonly activityLog: ActivityLogRepository,
  ) {}

  async execute(command: ReportTripProgressCommand): Promise<Result<TripProgressOutcome>> {
    const scope = ScopeStore.require();
    if (!scope.permissions.has(ReportTripProgressUseCase.requiredPermission)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.ReportTransportOutcome}.`,
        ),
      );
    }

    const notFound = () =>
      Result.failure(
        UseCaseError.notFound('TRIP_NOT_FOUND', `Trip '${command.tripId}' does not exist.`),
      );
    if (!isTripId(command.tripId)) return notFound();
    const trip = await this.trips.findById(command.clientId, asTripId(command.tripId));
    // Driver binding is the boundary — another driver's trip reads as absent
    // (no id enumeration), same stance as the pick claim.
    if (!trip || trip.driverRef !== command.driverRef) return notFound();
    if (trip.status !== 'claimed') {
      return Result.failure(
        UseCaseError.businessRule(
          'TRIP_NOT_ACTIVE',
          `Trip '${trip.id}' is '${trip.status}' — nothing to report.`,
        ),
      );
    }

    const orders = await this.transportOrders.findManyByIds(command.clientId, [...trip.orderIds]);
    const targets =
      command.action === 'collected'
        ? orders
        : orders.filter((o) => o.id === command.orderId);
    if (targets.length === 0) {
      return Result.failure(
        UseCaseError.notFound(
          'STOP_NOT_FOUND',
          `Order '${command.orderId ?? '?'}' is not on trip '${trip.id}'.`,
        ),
      );
    }

    const status = command.action;
    const now = new Date();
    const updated: string[] = [];
    let lastCommit: Result<unknown> | null = null;
    for (const order of targets) {
      if (!TransportOrder.canAdvance(order, status)) continue; // replay/double-tap
      const next = TransportOrder.advance(order, status, now, {
        ...(command.action === 'failed'
          ? { failureReason: command.reason ?? 'driver reported failure' }
          : {}),
      });
      await this.activityLog.append({
        clientId: next.clientId,
        fulfilmentId: next.fulfilmentId,
        subjectType: 'transport_order',
        subjectId: next.id,
        source: 'domain',
        actor: scope.principalId,
        category: 'transport',
        message: `Part #${next.shortId} ${status} — driver report (trip ${trip.id}).`,
        data: { tripId: trip.id, ...(command.reason ? { reason: command.reason } : {}) },
      });
      const EventClass = TRANSPORT_ORDER_EVENT_BY_STATUS[status];
      const committed = await commitAggregate(
        this.uow,
        this.registry,
        next,
        new EventClass(scope, {
          transportOrderId: next.id,
          clientId: next.clientId,
          fulfilmentId: next.fulfilmentId,
          partId: next.partId,
          shortId: next.shortId,
          provider: next.provider,
          providerRef: next.providerRef,
          ...(command.action === 'failed'
            ? { reason: command.reason ?? 'driver reported failure' }
            : {}),
        }),
        command,
      );
      if (isFailure(committed)) return committed;
      lastCommit = committed;
      updated.push(next.id);
    }

    if (updated.length === 0) {
      return Result.failure(
        UseCaseError.businessRule(
          'ALREADY_REPORTED',
          `Every targeted stop is already at or past '${status}'.`,
        ),
      );
    }

    // Trip closes when every member order is terminal (delivered/failed).
    const fresh = await this.transportOrders.findManyByIds(command.clientId, [...trip.orderIds]);
    const allTerminal =
      fresh.length === trip.orderIds.length && fresh.every((o) => TransportOrder.isTerminal(o));
    if (allTerminal) {
      const completed = Trip.complete(trip, now);
      const committed = await commitAggregate(
        this.uow,
        this.registry,
        completed,
        new TripCompleted(scope, {
          tripId: completed.id,
          clientId: completed.clientId,
          originRef: completed.originRef,
          provider: completed.provider,
          driverRef: completed.driverRef,
          vehicleRef: completed.vehicleRef,
          transportOrderIds: [...completed.orderIds],
          partShortIds: completed.stops.map((s) => s.shortId),
        }),
        command,
      );
      return Result.map(committed, () => ({ updatedOrders: updated, tripCompleted: true }));
    }

    // Something moved but the trip stays open — success rides the last
    // order commit (Result.success is UoW-restricted by design).
    return Result.map(lastCommit!, () => ({ updatedOrders: updated, tripCompleted: false }));
  }
}
