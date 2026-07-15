/**
 * Driver status reporting for OWN-channel trips — the execution app's
 * counterpart of the provider webhooks (own-channel execution has no
 * webhook source; the driver IS the signal):
 *
 *   collected            — per stop (scan evidence or store-pin override),
 *                          or trip-wide without an orderId (bulk button)
 *   delivered / failed   — per stop (order); failure carries a reason
 *
 * HANDOVER VERIFICATION (docs/handover-verification.md) is DEFERRED, never
 * blocking: the app queues reports offline and the server verifies whenever
 * a report arrives — evidence is recorded verbatim, pins are compared
 * against the FULFILMENT aggregate (the only place pin values live), and a
 * mismatch/not-checked outcome surfaces as a flightboard exception instead
 * of a rejection (the physical handover already happened).
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
import type { Fulfilment } from '../../domain/fulfilments/fulfilment.js';
import { asFulfilmentId } from '../../domain/fulfilments/ids.js';
import type { FulfilmentRepository } from '../../domain/fulfilments/fulfilment.repository.js';
import {
  TransportOrder,
  requiredDeliveryProof,
  type CollectionEvidence,
  type DeliveryEvidence,
  type PinVerificationOutcome,
} from '../../domain/transport-orders/transport-order.js';
import { TRANSPORT_ORDER_EVENT_BY_STATUS } from '../../domain/transport-orders/events/transport-order.events.js';
import type { TransportOrderRepository } from '../../domain/transport-orders/transport-order.repository.js';
import { Trip } from '../../domain/trips/trip.js';
import { asTripId, isTripId } from '../../domain/trips/ids.js';
import { TripCompleted } from '../../domain/trips/events/trip.events.js';
import type { TripRepository } from '../../domain/trips/trip.repository.js';
import type { ActivityLogRepository } from '../../infrastructure/activity-log-repository.js';

export type TripProgressAction = 'collected' | 'delivered' | 'failed';

/** Driver-supplied handover evidence (captured offline-first by the app). */
export interface ReportEvidenceInput {
  /** Collection: how the stop was confirmed. Absent = bulk (trip-wide). */
  readonly method?: 'scan' | 'pin' | null;
  readonly scannedRefs?: readonly string[] | null;
  /** Entered pin — pickup pin (collection override) or delivery pin. */
  readonly pinEntered?: string | null;
  /** Delivery of an age-restricted order: how the age was checked. */
  readonly ageCheck?: {
    readonly method: 'id-attestation' | 'visual-override';
    readonly docType?: string | undefined;
  } | null;
  /** Proof-of-delivery photo (client-generated blob ref, pod_…). */
  readonly photoRef?: string | null;
  /** The driver's "I've arrived" tap (ISO). */
  readonly arrivedAt?: string | null;
}

export interface ReportTripProgressCommand {
  readonly clientId: string;
  readonly tripId: string;
  /** The session's driver — must be the trip's claimer. */
  readonly driverRef: string;
  readonly action: TripProgressAction;
  /** Per-stop target; for `collected` absent = every order (bulk). */
  readonly orderId?: string | null;
  readonly reason?: string | null;
  readonly evidence?: ReportEvidenceInput | null;
}

export interface TripProgressOutcome {
  readonly updatedOrders: readonly string[];
  /** Every member order at collected-or-later after this report. */
  readonly allCollected: boolean;
  readonly tripCompleted: boolean;
  /** Server-stamped pin outcome for THIS report, when a pin was involved. */
  readonly pinOutcome?: PinVerificationOutcome;
}

export class ReportTripProgressUseCase {
  static readonly requiredPermission = FulfilGoPermission.ReportTransportOutcome;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly trips: TripRepository,
    private readonly transportOrders: TransportOrderRepository,
    private readonly fulfilments: FulfilmentRepository,
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
      command.action === 'collected' && !command.orderId
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

    // Pin comparisons read the FULFILMENT aggregate (pins live only there);
    // one trip can span several fulfilments — cache per report.
    const fulfilmentCache = new Map<string, Fulfilment | null>();
    const loadFulfilment = async (fulfilmentId: string): Promise<Fulfilment | null> => {
      if (!fulfilmentCache.has(fulfilmentId)) {
        fulfilmentCache.set(
          fulfilmentId,
          await this.fulfilments.findById(command.clientId, asFulfilmentId(fulfilmentId)),
        );
      }
      return fulfilmentCache.get(fulfilmentId) ?? null;
    };

    const status = command.action;
    const now = new Date();
    const evidence = command.evidence ?? null;
    const updated: string[] = [];
    let reportPinOutcome: PinVerificationOutcome | undefined;
    let lastCommit: Result<unknown> | null = null;
    for (const order of targets) {
      if (!TransportOrder.canAdvance(order, status)) continue; // replay/double-tap

      let collectionEvidence: CollectionEvidence | undefined;
      let deliveryEvidence: DeliveryEvidence | undefined;
      if (status === 'collected') {
        if (evidence?.method === 'pin' && command.orderId) {
          const fulfilment = await loadFulfilment(order.fulfilmentId);
          const expected =
            fulfilment?.parts.find((p) => p.id === order.partId)?.pickupPin ?? null;
          const pinOutcome: PinVerificationOutcome =
            expected === null
              ? 'not-checked'
              : evidence.pinEntered === expected
                ? 'verified'
                : 'mismatch';
          reportPinOutcome = pinOutcome;
          collectionEvidence = { method: 'pin', pinOutcome, at: now.toISOString() };
        } else if (evidence?.method === 'scan') {
          collectionEvidence = {
            method: 'scan',
            scannedRefs: evidence.scannedRefs ?? [],
            at: now.toISOString(),
          };
        } else {
          collectionEvidence = { method: 'bulk', at: now.toISOString() };
        }
      } else if (status === 'delivered') {
        const requirements = order.verification?.requirements;
        // Pin verification only applies when the proof MODE is 'pin'.
        let pinOutcome: DeliveryEvidence['pinOutcome'] = 'not-required';
        if (requiredDeliveryProof(requirements) === 'pin') {
          if (evidence?.pinEntered == null || evidence.pinEntered === '') {
            pinOutcome = 'not-checked';
          } else {
            const fulfilment = await loadFulfilment(order.fulfilmentId);
            pinOutcome =
              fulfilment?.deliveryPin != null && evidence.pinEntered === fulfilment.deliveryPin
                ? 'verified'
                : 'mismatch';
          }
          reportPinOutcome = pinOutcome as PinVerificationOutcome;
        }
        deliveryEvidence = {
          pinOutcome,
          ageCheck: evidence?.ageCheck ?? null,
          photoRef: evidence?.photoRef ?? null,
          arrivedAt: evidence?.arrivedAt ?? null,
          at: now.toISOString(),
        };
      }

      const next = TransportOrder.advance(order, status, now, {
        ...(command.action === 'failed'
          ? { failureReason: command.reason ?? 'driver reported failure' }
          : {}),
        ...(collectionEvidence ? { collectionEvidence } : {}),
        ...(deliveryEvidence ? { deliveryEvidence } : {}),
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
        data: {
          tripId: trip.id,
          ...(command.reason ? { reason: command.reason } : {}),
          ...(collectionEvidence ? { collection: collectionEvidence } : {}),
          ...(deliveryEvidence ? { delivery: deliveryEvidence } : {}),
        },
      });
      // Deferred verification: a bad/unchecked outcome is RECORDED (the
      // goods already changed hands) and flagged for ops — never rejected.
      const flagged = TransportOrder.verificationIssue(next);
      if (flagged) {
        await this.activityLog.append({
          clientId: next.clientId,
          fulfilmentId: next.fulfilmentId,
          subjectType: 'transport_order',
          subjectId: next.id,
          source: 'domain',
          actor: scope.principalId,
          category: 'verification',
          message: `Part #${next.shortId} ${status} with verification issue: ${flagged}.`,
          data: {
            tripId: trip.id,
            ...(evidence?.pinEntered && reportPinOutcome === 'mismatch'
              ? { enteredPin: evidence.pinEntered }
              : {}),
            ...(collectionEvidence ? { collection: collectionEvidence } : {}),
            ...(deliveryEvidence ? { delivery: deliveryEvidence } : {}),
          },
        });
      }
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

    const fresh = await this.transportOrders.findManyByIds(command.clientId, [...trip.orderIds]);
    const allCollected =
      fresh.length === trip.orderIds.length &&
      fresh.every((o) => TransportOrder.isTerminal(o) || o.status === 'collected');

    // Trip closes when every member order is terminal (delivered/failed).
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
      return Result.map(committed, () => ({
        updatedOrders: updated,
        allCollected: true,
        tripCompleted: true,
        ...(reportPinOutcome ? { pinOutcome: reportPinOutcome } : {}),
      }));
    }

    // Something moved but the trip stays open — success rides the last
    // order commit (Result.success is UoW-restricted by design).
    return Result.map(lastCommit!, () => ({
      updatedOrders: updated,
      allCollected,
      tripCompleted: false,
      ...(reportPinOutcome ? { pinOutcome: reportPinOutcome } : {}),
    }));
  }
}

/**
 * ONLINE interactive pin check (docs/handover-verification.md): the app
 * pre-verifies BEFORE handover when it has connectivity — wrong pin at the
 * door means the driver withholds the goods. Offline the app skips this and
 * the report's deferred verification takes over. Failed attempts are logged
 * (detached — a read path) for the ops trail; the ROUTE rate-limits.
 */
export interface VerifyHandoverPinCommand {
  readonly clientId: string;
  readonly tripId: string;
  readonly driverRef: string;
  readonly orderId: string;
  readonly kind: 'pickup' | 'delivery';
  readonly pin: string;
}

export type VerifyHandoverPinResult =
  | { readonly ok: true; readonly verified: boolean }
  | { readonly ok: false; readonly status: 404 | 422; readonly code: string; readonly message: string };

export class VerifyHandoverPinUseCase {
  constructor(
    private readonly trips: TripRepository,
    private readonly transportOrders: TransportOrderRepository,
    private readonly fulfilments: FulfilmentRepository,
    private readonly activityLog: ActivityLogRepository,
  ) {}

  // A READ (pool queries + detached audit), so no UoW/Result ceremony —
  // sealed Result.success is deliberately UoW-only.
  async execute(command: VerifyHandoverPinCommand): Promise<VerifyHandoverPinResult> {
    const scope = ScopeStore.require();
    const notFound: VerifyHandoverPinResult = {
      ok: false,
      status: 404,
      code: 'TRIP_NOT_FOUND',
      message: `Trip '${command.tripId}' does not exist.`,
    };
    if (!isTripId(command.tripId)) return notFound;
    const trip = await this.trips.findById(command.clientId, asTripId(command.tripId));
    if (!trip || trip.driverRef !== command.driverRef) return notFound;
    const order = (
      await this.transportOrders.findManyByIds(command.clientId, [...trip.orderIds])
    ).find((o) => o.id === command.orderId);
    if (!order) {
      return {
        ok: false,
        status: 404,
        code: 'STOP_NOT_FOUND',
        message: `Order '${command.orderId}' is not on trip '${trip.id}'.`,
      };
    }

    const fulfilment = await this.fulfilments.findById(
      command.clientId,
      asFulfilmentId(order.fulfilmentId),
    );
    const expected =
      command.kind === 'pickup'
        ? (fulfilment?.parts.find((p) => p.id === order.partId)?.pickupPin ?? null)
        : (fulfilment?.deliveryPin ?? null);
    if (expected === null) {
      return {
        ok: false,
        status: 422,
        code: 'PIN_NOT_SET',
        message: `No ${command.kind} pin exists for this order (policy off or pre-feature).`,
      };
    }

    const verified = command.pin === expected;
    if (!verified) {
      await this.activityLog.appendDetached({
        clientId: order.clientId,
        fulfilmentId: order.fulfilmentId,
        subjectType: 'transport_order',
        subjectId: order.id,
        source: 'domain',
        actor: scope.principalId,
        category: 'verification',
        message: `Failed ${command.kind}-pin attempt on part #${order.shortId} (trip ${trip.id}).`,
        data: { tripId: trip.id, enteredPin: command.pin },
      });
    }
    return { ok: true, verified };
  }
}
