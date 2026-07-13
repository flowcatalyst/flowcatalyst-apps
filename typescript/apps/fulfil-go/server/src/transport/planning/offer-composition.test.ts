import { describe, expect, it, vi } from 'vitest';
import type { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import type { RouterClient, SolveResponse } from '../router/client.js';
import { rankOfferFeed, selectOfferOrders, sequenceTripStops } from './offer-composition.js';

const NOW = new Date('2026-07-13T08:00:00Z');
const STORE_GEO = { lat: -33.92, lng: 18.417 };

let seq = 0;
function order(overrides: Partial<TransportOrder> & { id?: string } = {}): TransportOrder {
  seq += 1;
  const id = overrides.id ?? `tro_TEST${seq}`;
  return {
    id,
    clientId: 'clt_TEST',
    fulfilmentId: `ful_TEST${seq}`,
    partId: `flp_TEST${seq}`,
    shortId: `${100 + seq}`,
    status: 'requested',
    serviceLevel: 'STANDARD',
    originRef: 'store-1',
    origin: {
      name: 'Store 1',
      address: { line1: '1 Store St', city: 'CT', countryCode: 'ZA' },
      geo: STORE_GEO,
      phone: '',
    },
    destination: {
      name: `Customer ${seq}`,
      address: { line1: `${seq} Home Rd`, city: 'CT', countryCode: 'ZA' },
      geo: { lat: -33.945, lng: 18.45 },
      phone: '',
    },
    window: {
      slotStart: new Date('2026-07-13T09:00:00Z'),
      slotEnd: new Date('2026-07-13T10:00:00Z'),
    },
    parcels: [
      { ref: `pkg_${seq}A`, kind: 'bag', size: 'M', temperature: 'ambient', description: 'Bag' },
    ],
    requiresVehicle: false,
    provider: 'own',
    candidateProviders: ['own'],
    providerRef: null,
    trackingUrl: null,
    courier: null,
    failureReason: null,
    reservation: null,
    version: 1,
    createdAt: new Date('2026-07-13T07:00:00Z'),
    updatedAt: new Date('2026-07-13T07:00:00Z'),
    ...overrides,
  } as TransportOrder;
}

describe('rankOfferFeed', () => {
  it('ranks ASAP first, then oldest slot (the flightboard rule)', () => {
    const late = order({
      window: {
        slotStart: new Date('2026-07-13T11:00:00Z'),
        slotEnd: new Date('2026-07-13T12:00:00Z'),
      },
    });
    const early = order({
      window: {
        slotStart: new Date('2026-07-13T09:00:00Z'),
        slotEnd: new Date('2026-07-13T10:00:00Z'),
      },
    });
    const asap = order({
      serviceLevel: 'ASAP',
      window: {
        slotStart: new Date('2026-07-13T11:30:00Z'),
        slotEnd: new Date('2026-07-13T12:30:00Z'),
      },
    });
    expect(rankOfferFeed([late, early, asap]).map((o) => o.id)).toEqual([
      asap.id,
      early.id,
      late.id,
    ]);
  });
});

describe('selectOfferOrders', () => {
  const caps = { maxStops: 3, maxBags: 12 };

  it('returns null on an empty/fully-reserved feed', () => {
    const held = order({
      reservation: {
        tripId: 'trp_X',
        driverRef: 'D',
        vehicleRef: 'V',
        expiresAt: new Date(NOW.getTime() + 30_000),
      },
    });
    expect(selectOfferOrders([], null, caps, NOW)).toBeNull();
    expect(selectOfferOrders([held], null, caps, NOW)).toBeNull();
  });

  it('an EXPIRED reservation is free — no sweeper needed', () => {
    const lapsed = order({
      reservation: {
        tripId: 'trp_X',
        driverRef: 'D',
        vehicleRef: 'V',
        expiresAt: new Date(NOW.getTime() - 1000),
      },
    });
    expect(selectOfferOrders([lapsed], null, caps, NOW)?.orders).toHaveLength(1);
  });

  it('consolidates compatible nearby orders up to the stop cap', () => {
    const a = order();
    const b = order({ destination: { ...a.destination, geo: { lat: -33.946, lng: 18.451 } } });
    const c = order({ destination: { ...a.destination, geo: { lat: -33.947, lng: 18.452 } } });
    const d = order({ destination: { ...a.destination, geo: { lat: -33.948, lng: 18.453 } } });
    const selected = selectOfferOrders([a, b, c, d], null, caps, NOW);
    expect(selected?.orders).toHaveLength(3); // maxStops
    expect(selected?.orders[0]?.id).toBe(a.id);
  });

  it('drops companions beyond the 5km radius or with disjoint windows', () => {
    const seed = order();
    const far = order({ destination: { ...seed.destination, geo: { lat: -34.1, lng: 18.9 } } });
    const disjoint = order({
      window: {
        slotStart: new Date('2026-07-13T14:00:00Z'),
        slotEnd: new Date('2026-07-13T15:00:00Z'),
      },
    });
    expect(selectOfferOrders([seed, far, disjoint], null, caps, NOW)?.orders).toHaveLength(1);
  });

  it('a HOT order never consolidates, in either direction', () => {
    const hot = order({
      serviceLevel: 'ASAP',
      parcels: [{ ref: 'p', kind: 'bag', size: 'M', temperature: 'hot', description: 'Hot bag' }],
    });
    const cold = order();
    // hot seed stays solo
    expect(selectOfferOrders([hot, cold], null, caps, NOW)?.orders).toEqual([hot]);
    // hot never rides as a companion either
    const selected = selectOfferOrders([cold, hot], cold, caps, NOW);
    expect(selected?.orders.map((o) => o.id)).toEqual([cold.id]);
  });

  it('respects the bag cap', () => {
    const seed = order();
    const bulky = order({
      parcels: Array.from({ length: 12 }, (_, i) => ({
        ref: `p${i}`,
        kind: 'bag' as const,
        size: 'M' as const,
        temperature: 'ambient',
        description: 'Bag',
      })),
    });
    expect(selectOfferOrders([seed, bulky], null, caps, NOW)?.orders).toEqual([seed]);
  });

  it('anchors the offer on the given seed', () => {
    const a = order({ serviceLevel: 'ASAP' });
    const anchor = order();
    const selected = selectOfferOrders([a, anchor], anchor, caps, NOW);
    expect(selected?.orders[0]?.id).toBe(anchor.id);
  });
});

describe('sequenceTripStops', () => {
  it('falls back to slot order without a router', async () => {
    const b = order({
      window: {
        slotStart: new Date('2026-07-13T09:30:00Z'),
        slotEnd: new Date('2026-07-13T10:30:00Z'),
      },
    });
    const a = order({
      window: {
        slotStart: new Date('2026-07-13T09:00:00Z'),
        slotEnd: new Date('2026-07-13T10:00:00Z'),
      },
    });
    const route = await sequenceTripStops(null, STORE_GEO, { orders: [b, a] });
    expect(route.stops.map((s) => s.orderId)).toEqual([a.id, b.id]);
    expect(route.stops[0]?.legKm).toBeGreaterThan(0);
    expect(route.routeKm).toBeGreaterThan(0);
  });

  it('uses the VROOM step order when the router solves', async () => {
    const a = order();
    const b = order({ destination: { ...a.destination, geo: { lat: -33.95, lng: 18.46 } } });
    const solve: SolveResponse = {
      solve: {
        code: 0,
        summary: { cost: 1, unassigned: 0 },
        routes: [
          {
            vehicle: 1,
            distance: 8000,
            duration: 1200,
            steps: [
              { type: 'start' },
              { type: 'job', id: 2 },
              { type: 'job', id: 1 },
              { type: 'end' },
            ],
          },
        ],
      },
    };
    const router = { solve: vi.fn().mockResolvedValue(solve) } as unknown as RouterClient;
    const route = await sequenceTripStops(router, STORE_GEO, { orders: [a, b] });
    expect(route.stops.map((s) => s.orderId)).toEqual([b.id, a.id]);
    expect(route.routeKm).toBe(8);
    expect(route.routeMinutes).toBe(20);
  });

  it('degrades to slot order when the router throws', async () => {
    const a = order();
    const b = order();
    const router = {
      solve: vi.fn().mockRejectedValue(new Error('busy')),
    } as unknown as RouterClient;
    const route = await sequenceTripStops(router, STORE_GEO, { orders: [a, b] });
    expect(route.stops).toHaveLength(2);
  });
});
