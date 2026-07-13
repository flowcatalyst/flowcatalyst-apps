import { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import type { TripStop } from '../../domain/trips/trip.js';
import { haversineKm } from '../provider-resolver.js';
import type { RouterClient } from '../router/client.js';

/**
 * Offer composition (docs/transport-context.md "Offer composition" — locked
 * 2026-07-13): an offer is a TRIP, multi-stop when possible. Pure selection
 * here; sequencing calls the router (VROOM) with a deterministic fallback.
 *
 * Selection rules:
 * - Seed = the anchor when the driver entered a reference, else the
 *   flightboard-ranked head (ASAP first, then oldest slot).
 * - Companions must share the origin store (the feed guarantees it), have
 *   slot windows overlapping the seed's within a tolerance, and drop within
 *   COMPANION_RADIUS_KM of the seed's dropoff (the incumbent EPOD flow's
 *   4–5km rule — a cheap detour cap that needs no router call).
 * - Caps come from store settings (maxStopsPerTrip / maxBagsPerTrip —
 *   simple caps only, no vehicle registry; Andrew 2026-07-13).
 * - HOT parcels never consolidate: a trip carrying hot food is solo, so a
 *   detour can't sit between the fryer and the customer.
 */
export const COMPANION_RADIUS_KM = 5;
export const WINDOW_OVERLAP_TOLERANCE_MINUTES = 30;
/** Mirrors the EPOD claim flow's 30s offer TTL — the driver app's rhythm. */
export const OFFER_TTL_SECONDS = 30;

/** Crow-flight → road estimate for fallback leg metrics. */
const ROAD_DISTANCE_FACTOR = 1.3;
const FALLBACK_SPEED_KMH = 30;

export interface OfferCaps {
  readonly maxStops: number;
  readonly maxBags: number;
  /**
   * Vehicle-class capacity in UNITS (client settings; Andrew 2026-07-13):
   * each parcel costs `unitSizes[size] ?? 1` units. Null = no class cap
   * (unknown vehicle / class-less driver).
   */
  readonly maxUnits?: number | null;
  readonly unitSizes?: Readonly<Record<string, number>>;
}

function isAsap(order: TransportOrder): boolean {
  return order.serviceLevel.toUpperCase() === 'ASAP';
}

function isHot(order: TransportOrder): boolean {
  return order.parcels.some((p) => p.temperature === 'hot');
}

function bagCount(order: TransportOrder): number {
  return order.parcels.length;
}

/** Capacity units for an order's parcels (size → units, default 1). */
export function unitCount(
  order: TransportOrder,
  unitSizes: Readonly<Record<string, number>>,
): number {
  return order.parcels.reduce((sum, p) => sum + (unitSizes[p.size ?? ''] ?? 1), 0);
}

function windowsOverlap(a: TransportOrder, b: TransportOrder, toleranceMinutes: number): boolean {
  const tol = toleranceMinutes * 60_000;
  return (
    b.window.slotStart.getTime() <= a.window.slotEnd.getTime() + tol &&
    b.window.slotEnd.getTime() >= a.window.slotStart.getTime() - tol
  );
}

/** Flightboard rule: ASAP first, then oldest slot, then oldest request. */
export function rankOfferFeed(orders: readonly TransportOrder[]): TransportOrder[] {
  return orders.toSorted((a, b) => {
    if (isAsap(a) !== isAsap(b)) return isAsap(a) ? -1 : 1;
    const slot = a.window.slotStart.getTime() - b.window.slotStart.getTime();
    if (slot !== 0) return slot;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export interface OfferSelection {
  /** Seed first; companions in least-added-detour (nearest-drop) order. */
  readonly orders: readonly TransportOrder[];
}

/**
 * Select the offer group from the store's offerable feed. `seed` is the
 * anchor when one was requested (the caller verified it is offerable);
 * otherwise the ranked head. Returns null when the feed is empty.
 */
export function selectOfferOrders(
  feed: readonly TransportOrder[],
  seed: TransportOrder | null,
  caps: OfferCaps,
  now: Date,
): OfferSelection | null {
  const offerable = feed.filter((o) => TransportOrder.isOfferable(o, now));
  const head = seed ?? rankOfferFeed(offerable)[0] ?? null;
  if (!head) return null;

  const selected: TransportOrder[] = [head];
  if (isHot(head)) return { orders: selected };

  const unitSizes = caps.unitSizes ?? {};
  const maxUnits = caps.maxUnits ?? null;
  let bags = bagCount(head);
  let units = unitCount(head, unitSizes);
  const seedGeo = head.destination.geo;
  if (!seedGeo) return { orders: selected }; // can't measure detours — solo

  const companions = offerable
    .filter((o) => o.id !== head.id)
    // Trips are single-origin (locked design) — a depot-wide feed may span
    // stores, so companions must share the seed's store.
    .filter((o) => o.originRef === head.originRef)
    .filter((o) => !isHot(o))
    .filter((o) => windowsOverlap(head, o, WINDOW_OVERLAP_TOLERANCE_MINUTES))
    .map((o) => ({
      order: o,
      km: o.destination.geo ? haversineKm(seedGeo, o.destination.geo) : Number.POSITIVE_INFINITY,
    }))
    .filter((c) => c.km <= COMPANION_RADIUS_KM)
    .toSorted((a, b) => a.km - b.km);

  for (const { order } of companions) {
    if (selected.length >= caps.maxStops) break;
    if (bags + bagCount(order) > caps.maxBags) continue;
    const orderUnits = unitCount(order, unitSizes);
    if (maxUnits !== null && units + orderUnits > maxUnits) continue;
    selected.push(order);
    bags += bagCount(order);
    units += orderUnits;
  }
  return { orders: selected };
}

export interface SequencedRoute {
  readonly stops: readonly TripStop[];
  readonly routeKm: number | null;
  readonly routeMinutes: number | null;
}

function fallbackLeg(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | undefined,
): { km: number | null; minutes: number | null } {
  if (!from || !to) return { km: null, minutes: null };
  const km = haversineKm(from, to) * ROAD_DISTANCE_FACTOR;
  return { km, minutes: (km / FALLBACK_SPEED_KMH) * 60 };
}

function toStops(
  ordered: readonly TransportOrder[],
  storeGeo: { lat: number; lng: number } | null,
): SequencedRoute {
  let prev = storeGeo;
  let totalKm = 0;
  let totalMinutes = 0;
  let complete = true;
  const stops = ordered.map((order) => {
    const leg = fallbackLeg(prev, order.destination.geo);
    if (leg.km === null || leg.minutes === null) complete = false;
    else {
      totalKm += leg.km;
      totalMinutes += leg.minutes;
    }
    prev = order.destination.geo ?? prev;
    return {
      orderId: order.id,
      shortId: order.shortId,
      destination: order.destination,
      legKm: leg.km,
      legMinutes: leg.minutes,
    };
  });
  return {
    stops,
    routeKm: complete ? totalKm : null,
    routeMinutes: complete ? totalMinutes : null,
  };
}

/**
 * Sequence the selection's dropoffs. Multi-stop goes through the router
 * (VROOM `solve`; leg metrics stay haversine estimates — planning hints,
 * not billing data). Single-order trips, missing geo, an unconfigured
 * router, or a router failure all fall back to slot order.
 */
export async function sequenceTripStops(
  router: RouterClient | null,
  storeGeo: { lat: number; lng: number } | null,
  selection: OfferSelection,
): Promise<SequencedRoute> {
  const bySlot = selection.orders.toSorted(
    (a, b) => a.window.slotStart.getTime() - b.window.slotStart.getTime(),
  );
  if (
    selection.orders.length < 2 ||
    !router ||
    !storeGeo ||
    selection.orders.some((o) => !o.destination.geo)
  ) {
    return toStops(bySlot, storeGeo);
  }

  try {
    const result = await router.solve({
      vehicles: [{ id: 1, start: [storeGeo.lng, storeGeo.lat] }],
      jobs: selection.orders.map((o, i) => ({
        id: i + 1,
        // Geo presence checked above; VROOM speaks [lon, lat].
        location: [o.destination.geo!.lng, o.destination.geo!.lat],
      })),
    });
    const route = result.solve.routes[0];
    if (!route || (result.solve.unassigned?.length ?? 0) > 0) {
      return toStops(bySlot, storeGeo);
    }
    const ordered = route.steps
      .filter((s) => s.type === 'job' && s.id !== undefined)
      .map((s) => selection.orders[(s.id as number) - 1])
      .filter((o): o is TransportOrder => o !== undefined);
    if (ordered.length !== selection.orders.length) return toStops(bySlot, storeGeo);

    const sequenced = toStops(ordered, storeGeo);
    // Prefer the solver's totals when it reports them (meters/seconds).
    return {
      stops: sequenced.stops,
      routeKm: route.distance !== undefined ? route.distance / 1000 : sequenced.routeKm,
      routeMinutes: route.duration !== undefined ? route.duration / 60 : sequenced.routeMinutes,
    };
  } catch {
    // Router down ≠ no offers — degrade to slot order.
    return toStops(bySlot, storeGeo);
  }
}
