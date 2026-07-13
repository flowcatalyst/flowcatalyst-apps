import type { TransportOrderStatus, TransportParcel, TransportStop, TransportWindow } from '../../transport/provider-port.js';
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
  readonly requiresVehicle: boolean;
  /** Selected provider code; the ranked remainder backs the fallback chain. */
  readonly provider: string;
  readonly candidateProviders: readonly string[];
  /** Provider-side id once booked ('uber' delivery id, trip ref, …). */
  readonly providerRef: string | null;
  readonly trackingUrl: string | null;
  readonly courier: TransportCourier | null;
  readonly failureReason: string | null;
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
  readonly requiresVehicle: boolean;
  readonly provider: string;
  readonly candidateProviders: readonly string[];
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
      requiresVehicle: input.requiresVehicle,
      provider: input.provider,
      candidateProviders: input.candidateProviders,
      providerRef: null,
      trackingUrl: null,
      courier: null,
      failureReason: null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  isTerminal(order: TransportOrder): boolean {
    return TERMINAL.has(order.status);
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
    },
  ): TransportOrder {
    return {
      ...prior,
      status: next,
      courier: detail?.courier !== undefined ? detail.courier : prior.courier,
      trackingUrl: detail?.trackingUrl !== undefined ? detail.trackingUrl : prior.trackingUrl,
      failureReason:
        detail?.failureReason !== undefined ? detail.failureReason : prior.failureReason,
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
