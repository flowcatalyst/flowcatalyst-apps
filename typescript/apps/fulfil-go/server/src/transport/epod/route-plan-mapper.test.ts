import { describe, expect, it } from 'vitest';
import type { Fulfilment } from '../../domain/fulfilments/fulfilment.js';
import type { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import type { Trip } from '../../domain/trips/trip.js';
import { EPOD_PLAN_CONTEXT_DEFAULTS, toEpodRoutePlan } from './route-plan-mapper.js';

const NOW = new Date('2026-07-13T08:00:00Z');

const CONTEXT = {
  companyReference: 'metro',
  companyName: 'Metro',
  ...EPOD_PLAN_CONTEXT_DEFAULTS,
};

function makeOrder(
  id: string,
  partId: string,
  fulfilmentId: string,
  shortId: string,
): TransportOrder {
  return {
    id,
    clientId: 'clt_TEST',
    fulfilmentId,
    partId,
    shortId,
    status: 'requested',
    serviceLevel: 'STANDARD',
    originRef: 'epod-loc-store-1',
    origin: {
      name: 'Store 1',
      address: { line1: '1 Store St', city: 'Cape Town', countryCode: 'ZA' },
      geo: { lat: -33.92, lng: 18.417 },
      phone: '',
    },
    destination: {
      name: 'Jane Customer',
      address: {
        line1: '2 Home Rd',
        suburb: 'Gardens',
        city: 'Cape Town',
        region: 'WC',
        postalCode: '8001',
        countryCode: 'ZA',
      },
      geo: { lat: -33.945, lng: 18.45 },
      phone: '+27821234567',
      instructions: 'Gate code 1234',
    },
    window: {
      slotStart: new Date('2026-07-13T09:00:00Z'),
      slotEnd: new Date('2026-07-13T10:00:00Z'),
    },
    parcels: [{ ref: 'pkg_1', kind: 'bag', size: 'M', temperature: 'ambient', description: 'Bag' }],
    requiresVehicle: false,
    provider: 'epod',
    candidateProviders: ['epod'],
    providerRef: null,
    trackingUrl: null,
    courier: null,
    failureReason: null,
    reservation: null,
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as TransportOrder;
}

function makeFulfilment(id: string, partId: string): Fulfilment {
  return {
    id,
    destination: {
      location: {
        ref: null,
        name: 'Jane Customer',
        address: { line1: '2 Home Rd', city: 'Cape Town', countryCode: 'ZA' },
        geo: { lat: -33.945, lng: 18.45 },
        contact: { name: 'Jane', email: 'jane@example.com' },
      },
    },
    parts: [
      {
        id: partId,
        lines: [
          { externalLineRef: 'L1', sku: 'SKU-MILK', description: 'Milk 2L', quantity: 2 },
          { externalLineRef: 'L2', sku: 'SKU-BREAD', description: 'Bread', quantity: 1 },
        ],
        lineResults: [
          { externalLineRef: 'L1', pickedQuantity: 2 },
          { externalLineRef: 'L2', pickedQuantity: 0 },
        ],
      },
    ],
  } as unknown as Fulfilment;
}

function makeTrip(orderIds: string[], stops: { orderId: string; shortId: string }[]): Trip {
  return {
    id: 'trp_TEST1',
    clientId: 'clt_TEST',
    originRef: 'epod-loc-store-1',
    provider: 'epod',
    status: 'offered',
    driverRef: 'CS001',
    vehicleRef: 'FS74GFGP',
    depotRef: 'FGO-DEPOT-1',
    territoryRef: 'FGO Territory',
    orderIds,
    anchorOrderId: null,
    stops: stops.map((s) => ({
      ...s,
      destination: {
        name: 'Jane Customer',
        address: { line1: '2 Home Rd', city: 'Cape Town', countryCode: 'ZA' },
        geo: { lat: -33.945, lng: 18.45 },
        phone: '',
      },
      legKm: 4.2,
      legMinutes: 12,
    })),
    offerExpiresAt: new Date(NOW.getTime() + 30_000),
    routeKm: 4.2,
    routeMinutes: 12,
    failureReason: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as Trip;
}

describe('toEpodRoutePlan', () => {
  const order = makeOrder('tro_A', 'flp_A', 'ful_A', '104');
  const fulfilment = makeFulfilment('ful_A', 'flp_A');
  const trip = makeTrip(['tro_A'], [{ orderId: 'tro_A', shortId: '104' }]);

  const plan = toEpodRoutePlan({
    trip,
    ordersById: new Map([['tro_A', order]]),
    fulfilmentsById: new Map([['ful_A', fulfilment]]),
    context: CONTEXT,
    now: NOW,
  });
  const route = plan.company.routes[0]!;

  it('keys the route on the trip id (their idempotency unit)', () => {
    expect(route.reference).toBe('trp_TEST1');
    expect(route.trips[0]!.reference).toBe('trp_TEST1-T1');
  });

  it('binds the offer context: depot/territory/vehicle/driver', () => {
    expect(route.depot.reference).toBe('FGO-DEPOT-1');
    expect(route.territory.reference).toBe('FGO Territory');
    expect(route.vehicle.registrationNumber).toBe('FS74GFGP');
    for (const stop of route.trips[0]!.stops) {
      expect(stop.driver).toEqual({ reference: 'CS001' });
    }
  });

  it('builds Pick-at-store + Drop-per-order stops with the EPOD location refs', () => {
    const stops = route.trips[0]!.stops;
    expect(stops).toHaveLength(2);
    expect(stops[0]!.stopType).toBe('Pick');
    expect(stops[0]!.locationReference).toBe('epod-loc-store-1'); // origin.ref IS their ref
    expect(stops[1]!.stopType).toBe('Drop');
    expect(stops[1]!.locationReference).toBe('fulfilgo-dest-ful_A'); // provisioning convention
    expect(stops[1]!.qrCode).toBe('104');
    expect(stops[1]!.instruction).toBe('Gate code 1234');
  });

  it('orders carry our ids, the driver-visible short id, and PICKED quantities', () => {
    const planOrder = route.orders[0]!;
    expect(planOrder.orderNumber).toBe('tro_A');
    expect(planOrder.displayNumber).toBe('104');
    // zero-picked lines drop out; picked quantity wins over ordered
    expect(planOrder.items).toEqual([
      {
        itemNumber: '1',
        reference: 'SKU-MILK',
        packingUnitFlag: false,
        plannedItemQuantity: 2,
        plannedItemUom: 'EA',
      },
    ]);
    expect(planOrder.serviceDate).toBe('2026-07-13');
  });

  it('embeds destination + product masterdata but NEVER the store location', () => {
    const md = route.masterdata;
    expect(md.locations.map((l) => l.reference)).toEqual(['fulfilgo-dest-ful_A']);
    expect(md.locations[0]!.latitude).toBe('-33.945'); // strings on the wire
    expect(md.products.map((p) => p.reference)).toEqual(['SKU-MILK', 'SKU-BREAD']);
    expect(md.vehicles[0]!.registrationNumber).toBe('FS74GFGP');
    expect(md.company[0]).toEqual({ reference: 'metro', name: 'Metro' });
  });
});
