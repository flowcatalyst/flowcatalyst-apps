import type {
  TransportOrderStatus,
  TransportParcel,
  TransportStop,
  TransportWindow,
} from '../../transport/provider-port.js';
import type { TransportOrderId } from './ids.js';

export const TRANSPORT_ORDER_TYPE = 'TransportOrder' as const;

export type { TransportOrderStatus } from '../../transport/provider-port.js';

/**
 * TransportOrder — the REQUEST side of moving one picked fulfilment part
 * ("move these parcels from store X to destination Y within window W"),
 * provider-neutral (docs/transport-context.md). Providers fulfil it however
 * they do: our own planning/claim marketplace ('own', 'epod' — the order
 * stays `requested` until a trip claims it), or a provider-planned booking
 * ('uber' — the book landing pad drives it to `booked`).
 *
 * Status machine (normalized across providers, FORWARD-ONLY):
 *   requested → booked → assigned → collected → delivered | failed | cancelled
 * Providers may legitimately skip steps (a webhook can arrive out of order
 * or a lifecycle may not surface every stage) — transitions only ever move
 * the status FORWARD in rank, never backwards.
 */
export const STATUS_RANK: Record<TransportOrderStatus, number> = {
  requested: 0,
  booked: 1,
  assigned: 2,
  collected: 3,
  delivered: 4,
  failed: 4,
  cancelled: 4,
};

const TERMINAL: ReadonlySet<TransportOrderStatus> = new Set(['delivered', 'failed', 'cancelled']);

export interface TransportCourier {
  readonly name: string | null;
  readonly vehicleType: string | null;
  readonly phone: string | null;
}

/**
 * The planning marketplace's expiring hold (docs/transport-context.md
 * "Offer composition"): while a live reservation points at a trip, the
 * order is invisible to other offers. Expiry frees the order implicitly —
 * readers treat a lapsed reservation as no reservation; a new offer may
 * overwrite it (optimistic locking turns races into 409s).
 */
export interface TransportReservation {
  readonly tripId: string;
  readonly driverRef: string;
  readonly vehicleRef: string;
  readonly expiresAt: Date;
}

/**
 * Handover verification (docs/handover-verification.md): REQUIREMENTS are
 * captured at request time (from the fulfilment's stamped policy + pins —
 * booleans/ages only, never the pin VALUES); EVIDENCE is recorded by the
 * driver reports. Verification is DEFERRED, never blocking: reports are
 * always accepted (the physical handover already happened) and a mismatch
 * surfaces as a flightboard exception, not a rejection.
 */
export interface OrderVerificationRequirements {
  /** A pickup pin exists on the part (store can override a failed scan). */
  readonly pickupPin: boolean;
  /** A delivery pin exists on the fulfilment (customer handover). */
  readonly deliveryPin: boolean;
  /** Age-restricted order: minimum customer age; null = unrestricted. */
  readonly minAge: number | null;
  readonly ageVisualOverrideAllowed: boolean;
}

export type PinVerificationOutcome = 'verified' | 'mismatch' | 'not-checked';

export interface CollectionEvidence {
  /** scan = parcel barcodes matched; pin = store pin override; bulk = trip-wide button. */
  readonly method: 'scan' | 'pin' | 'bulk';
  readonly scannedRefs?: readonly string[];
  readonly pinOutcome?: PinVerificationOutcome;
  readonly at: string;
}

export interface DeliveryEvidence {
  readonly pinOutcome: PinVerificationOutcome | 'not-required';
  readonly ageCheck?: {
    readonly method: 'id-attestation' | 'visual-override';
    readonly docType?: string | undefined;
  } | null;
  readonly at: string;
}

export interface OrderVerification {
  readonly requirements: OrderVerificationRequirements;
  readonly collection?: CollectionEvidence;
  readonly delivery?: DeliveryEvidence;
}

export interface TransportOrder {
  readonly id: TransportOrderId;
  readonly clientId: string;
  readonly fulfilmentId: string;
  readonly partId: string;
  /** The part's human quick-reference (on the packaging — anchor claims). */
  readonly shortId: string;
  readonly status: TransportOrderStatus;
  readonly serviceLevel: string;
  /** Origin store ref (registry key) + the captured stop. */
  readonly originRef: string;
  readonly origin: TransportStop;
  readonly destination: TransportStop;
  readonly window: TransportWindow;
  readonly parcels: readonly TransportParcel[];
  readonly requiresCarOrLarger: boolean;
  /** Selected provider code; the ranked remainder backs the fallback chain. */
  readonly provider: string;
  readonly candidateProviders: readonly string[];
  /** Provider-side id once booked ('uber' delivery id, trip ref, …). */
  readonly providerRef: string | null;
  readonly trackingUrl: string | null;
  readonly courier: TransportCourier | null;
  readonly failureReason: string | null;
  /** Live only while `requested` — the planning marketplace's hold. */
  readonly reservation: TransportReservation | null;
  /** Requirements at request time + driver-report evidence; null pre-feature. */
  readonly verification: OrderVerification | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateTransportOrderInput {
  readonly id: TransportOrderId;
  readonly clientId: string;
  readonly fulfilmentId: string;
  readonly partId: string;
  readonly shortId: string;
  readonly serviceLevel: string;
  readonly originRef: string;
  readonly origin: TransportStop;
  readonly destination: TransportStop;
  readonly window: TransportWindow;
  readonly parcels: readonly TransportParcel[];
  readonly requiresCarOrLarger: boolean;
  readonly provider: string;
  readonly candidateProviders: readonly string[];
  readonly verificationRequirements: OrderVerificationRequirements;
  readonly now: Date;
}

export const TransportOrder = {
  create(input: CreateTransportOrderInput): TransportOrder {
    return {
      id: input.id,
      clientId: input.clientId,
      fulfilmentId: input.fulfilmentId,
      partId: input.partId,
      shortId: input.shortId,
      status: 'requested',
      serviceLevel: input.serviceLevel,
      originRef: input.originRef,
      origin: input.origin,
      destination: input.destination,
      window: input.window,
      parcels: input.parcels,
      requiresCarOrLarger: input.requiresCarOrLarger,
      provider: input.provider,
      candidateProviders: input.candidateProviders,
      providerRef: null,
      trackingUrl: null,
      courier: null,
      failureReason: null,
      reservation: null,
      verification: { requirements: input.verificationRequirements },
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /** A live (unexpired) hold makes the order invisible to other offers. */
  isReserved(order: TransportOrder, now: Date): boolean {
    return order.reservation !== null && order.reservation.expiresAt.getTime() > now.getTime();
  },

  /**
   * Offerable to the planning marketplace: requested and not held by a live
   * reservation (an expired hold is free — no sweeper needed).
   */
  isOfferable(order: TransportOrder, now: Date): boolean {
    return order.status === 'requested' && !TransportOrder.isReserved(order, now);
  },

  /** Take the marketplace hold. Caller guards `isOfferable` first. */
  reserve(prior: TransportOrder, reservation: TransportReservation, now: Date): TransportOrder {
    return { ...prior, reservation, version: prior.version + 1, updatedAt: now };
  },

  /** Free the hold (claim rejected / trip released). */
  releaseReservation(prior: TransportOrder, now: Date): TransportOrder {
    return { ...prior, reservation: null, version: prior.version + 1, updatedAt: now };
  },

  /**
   * A driver claimed the trip holding this order. Books and assigns in one
   * transition (the claim collapses booked/assigned — the claimer IS the
   * assignee, bound at offer time): providerRef = trip id, ONE version bump.
   */
  claimByTrip(
    prior: TransportOrder,
    provider: string,
    tripId: string,
    courier: TransportCourier,
    now: Date,
  ): TransportOrder {
    return {
      ...prior,
      status: 'assigned',
      provider,
      providerRef: tripId,
      courier,
      reservation: null,
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  isTerminal(order: TransportOrder): boolean {
    return TERMINAL.has(order.status);
  },

  /**
   * The recorded handover evidence, judged against the captured
   * requirements (docs/handover-verification.md): returns a human reason
   * when verification is missing/failed, null when everything checks out.
   * ONE truth for the report flagging and the flightboard exception.
   */
  verificationIssue(order: { readonly verification: OrderVerification | null }): string | null {
    const v = order.verification;
    if (!v) return null;
    if (v.collection?.pinOutcome === 'mismatch') return 'pickup pin mismatch at collection';
    if (!v.delivery) return null;
    if (v.delivery.pinOutcome === 'mismatch') return 'delivery pin mismatch';
    if (v.requirements.deliveryPin && v.delivery.pinOutcome === 'not-checked') {
      return 'delivery pin not checked';
    }
    if (v.requirements.minAge != null) {
      if (!v.delivery.ageCheck) return `age check missing (requires ${v.requirements.minAge}+)`;
      if (
        v.delivery.ageCheck.method === 'visual-override' &&
        !v.requirements.ageVisualOverrideAllowed
      ) {
        return 'visual age override used but not permitted';
      }
    }
    return null;
  },

  /**
   * Forward-only status advance from a provider signal. Same-rank or
   * backwards signals are stale — callers state-guard on `canAdvance`.
   */
  canAdvance(order: TransportOrder, next: TransportOrderStatus): boolean {
    return !TransportOrder.isTerminal(order) && STATUS_RANK[next] > STATUS_RANK[order.status];
  },

  advance(
    prior: TransportOrder,
    next: TransportOrderStatus,
    now: Date,
    detail?: {
      readonly courier?: TransportCourier | null;
      readonly trackingUrl?: string | null;
      readonly failureReason?: string | null;
      /** Handover evidence recorded WITH the transition (one version bump). */
      readonly collectionEvidence?: CollectionEvidence;
      readonly deliveryEvidence?: DeliveryEvidence;
    },
  ): TransportOrder {
    const verification =
      detail?.collectionEvidence || detail?.deliveryEvidence
        ? {
            requirements: prior.verification?.requirements ?? {
              pickupPin: false,
              deliveryPin: false,
              minAge: null,
              ageVisualOverrideAllowed: false,
            },
            ...(prior.verification?.collection ? { collection: prior.verification.collection } : {}),
            ...(prior.verification?.delivery ? { delivery: prior.verification.delivery } : {}),
            ...(detail.collectionEvidence ? { collection: detail.collectionEvidence } : {}),
            ...(detail.deliveryEvidence ? { delivery: detail.deliveryEvidence } : {}),
          }
        : prior.verification;
    return {
      ...prior,
      status: next,
      courier: detail?.courier !== undefined ? detail.courier : prior.courier,
      trackingUrl: detail?.trackingUrl !== undefined ? detail.trackingUrl : prior.trackingUrl,
      failureReason:
        detail?.failureReason !== undefined ? detail.failureReason : prior.failureReason,
      verification,
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  /** Provider accepted the booking — records who/where it is on their side. */
  book(
    prior: TransportOrder,
    provider: string,
    providerRef: string,
    trackingUrl: string | null,
    now: Date,
  ): TransportOrder {
    return {
      ...prior,
      status: 'booked',
      provider,
      providerRef,
      trackingUrl,
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  fail(prior: TransportOrder, reason: string, now: Date): TransportOrder {
    return {
      ...prior,
      status: 'failed',
      failureReason: reason,
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  cancel(prior: TransportOrder, reason: string | null, now: Date): TransportOrder {
    return {
      ...prior,
      status: 'cancelled',
      failureReason: reason,
      version: prior.version + 1,
      updatedAt: now,
    };
  },
} as const;
