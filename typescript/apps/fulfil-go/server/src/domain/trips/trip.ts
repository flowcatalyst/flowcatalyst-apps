import type { TransportStop } from '../../transport/provider-port.js';
import type { TripId } from './ids.js';

export const TRIP_TYPE = 'Trip' as const;

/**
 * Trip — the transport PLANNING context's aggregate (docs/transport-context.md
 * "Offer composition" + "Allocation strategies"): an OFFERED, ordered stop
 * sequence over one or more requested transport orders at one origin store.
 * A single-order trip is the degenerate case.
 *
 * The trip IS the reservation: it is created at OFFER time with the driver +
 * vehicle already bound (the EPOD semantic — preserved for our own app too),
 * and every member order takes an expiring hold pointing back at it. The
 * whole group reserves atomically or the offer shrinks before being
 * presented; claiming confirms the group as one unit.
 *
 * Status machine (forward-only):
 *   offered → claimed                     (driver confirmed; orders assigned)
 *   claimed → completed                   (every member order terminal —
 *                                          driver reporting closes the trip)
 *   offered → expired                     (hold lapsed — lazy, on next touch)
 *   offered|claimed → released            (route-plan push rejected, or an
 *                                          explicit release — orders freed)
 */
export type TripStatus = 'offered' | 'claimed' | 'completed' | 'expired' | 'released';

/** One planned dropoff, in driving sequence. Leg metrics are estimates. */
export interface TripStop {
  readonly orderId: string;
  /** The part's packaging short id — what the driver sees/scans. */
  readonly shortId: string;
  readonly destination: TransportStop;
  readonly legKm: number | null;
  readonly legMinutes: number | null;
}

export interface Trip {
  readonly id: TripId;
  readonly clientId: string;
  readonly originRef: string;
  /** Our-planned channel the offer was composed for ('own' | 'epod'). */
  readonly provider: string;
  readonly status: TripStatus;
  /** Bound at OFFER time, not claim time. */
  readonly driverRef: string;
  readonly vehicleRef: string;
  /** EPOD offer context, echoed into the route plan. Null on 'own'. */
  readonly depotRef: string | null;
  readonly territoryRef: string | null;
  readonly orderIds: readonly string[];
  /** Set when the offer was anchored on a driver-entered reference. */
  readonly anchorOrderId: string | null;
  /** Dropoffs in driving order (VROOM-sequenced when multi-stop). */
  readonly stops: readonly TripStop[];
  readonly offerExpiresAt: Date;
  readonly routeKm: number | null;
  readonly routeMinutes: number | null;
  readonly failureReason: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OfferTripInput {
  readonly id: TripId;
  readonly clientId: string;
  readonly originRef: string;
  readonly provider: string;
  readonly driverRef: string;
  readonly vehicleRef: string;
  readonly depotRef: string | null;
  readonly territoryRef: string | null;
  readonly orderIds: readonly string[];
  readonly anchorOrderId: string | null;
  readonly stops: readonly TripStop[];
  readonly offerExpiresAt: Date;
  readonly routeKm: number | null;
  readonly routeMinutes: number | null;
  readonly now: Date;
}

export const Trip = {
  offer(input: OfferTripInput): Trip {
    return {
      id: input.id,
      clientId: input.clientId,
      originRef: input.originRef,
      provider: input.provider,
      status: 'offered',
      driverRef: input.driverRef,
      vehicleRef: input.vehicleRef,
      depotRef: input.depotRef,
      territoryRef: input.territoryRef,
      orderIds: input.orderIds,
      anchorOrderId: input.anchorOrderId,
      stops: input.stops,
      offerExpiresAt: input.offerExpiresAt,
      routeKm: input.routeKm,
      routeMinutes: input.routeMinutes,
      failureReason: null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  isExpired(trip: Trip, now: Date): boolean {
    return trip.status === 'offered' && trip.offerExpiresAt.getTime() <= now.getTime();
  },

  /** Drop shrunk-away orders (reservation lost to a racing offer). */
  shrink(prior: Trip, keepOrderIds: ReadonlySet<string>): Trip {
    return {
      ...prior,
      orderIds: prior.orderIds.filter((id) => keepOrderIds.has(id)),
      stops: prior.stops.filter((s) => keepOrderIds.has(s.orderId)),
    };
  },

  claim(prior: Trip, now: Date): Trip {
    return { ...prior, status: 'claimed', version: prior.version + 1, updatedAt: now };
  },

  /** Every member order reached a terminal status — the trip is done. */
  complete(prior: Trip, now: Date): Trip {
    return { ...prior, status: 'completed', version: prior.version + 1, updatedAt: now };
  },

  expire(prior: Trip, now: Date): Trip {
    return { ...prior, status: 'expired', version: prior.version + 1, updatedAt: now };
  },

  release(prior: Trip, reason: string, now: Date): Trip {
    return {
      ...prior,
      status: 'released',
      failureReason: reason,
      version: prior.version + 1,
      updatedAt: now,
    };
  },
} as const;
