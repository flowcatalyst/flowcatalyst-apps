import type { Fulfilment } from '../../domain/fulfilments/fulfilment.js';
import type { TransportOrder } from '../../domain/transport-orders/transport-order.js';
import type { Trip } from '../../domain/trips/trip.js';
import type { TransportStop } from '../provider-port.js';
import { epodDestinationReference } from './provisioning-mapper.js';
import type { EpodPlanLocation, EpodPlanOrder, EpodPlanStop, EpodRoutePlan } from './types.js';

/**
 * Pure mapping from a CLAIMED trip onto EPOD's route-plan container — the
 * synchronous booking signal (docs/transport-context.md "EPOD integration
 * plan"). Conventions:
 *
 * - route reference = trip id (their idempotency key: a re-POST of the same
 *   trip answers 200 already_applied — crash-replay safe).
 * - orderNumber = our transport-order id; displayNumber = the part SHORT ID
 *   (what's on the packaging — the driver-facing number).
 * - origin stop references the store by `origin.ref` (IS the EPOD location
 *   reference — manually maintained topology, never embedded so we can't
 *   clobber their record); destinations embed the same reference/shape the
 *   provisioning push upserts.
 * - depot/territory come from the OFFER context (bound at offer time);
 *   transporter/vehicleType self-provision from config defaults. The
 *   vehicle is embedded (their intake only links vehicles present in
 *   masterdata) — configure `vehicleTypeReference` per store to a REAL
 *   EPOD type when retyping the vehicle matters.
 * - Times/legs are planning estimates; weights are not tracked (0 kg).
 */
export interface EpodPlanContext {
  readonly companyReference: string;
  readonly companyName: string;
  readonly transporterReference: string;
  readonly transporterName: string;
  readonly vehicleTypeReference: string;
  readonly vehicleTypeName: string;
  readonly vehicleTypeMaxWeightKg: number;
}

export const EPOD_PLAN_CONTEXT_DEFAULTS = {
  transporterReference: 'FULFILGO',
  transporterName: 'FulfilGo',
  vehicleTypeReference: 'FULFILGO-VAN',
  vehicleTypeName: 'FulfilGo Van',
  vehicleTypeMaxWeightKg: 900,
} as const;

/** Stop dwell estimate + fallback leg when route metrics are unknown. */
const STOP_SERVICE_MINUTES = 5;
const FALLBACK_LEG_MINUTES = 10;
const FALLBACK_LEG_KM = 5;

const SERVICE_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toPlanLocation(
  reference: string,
  stop: TransportStop,
  locationType: string,
  email: string | null,
): EpodPlanLocation | null {
  if (!stop.geo) return null;
  return {
    reference,
    name: stop.name,
    locationTypeReference: locationType,
    buildingNumber: null,
    buildingName: null,
    address1: stop.address.line1,
    address2: stop.address.line2 ?? '',
    address3: '',
    suburb: stop.address.suburb ?? null,
    postalCode: stop.address.postalCode ?? '',
    city: stop.address.city,
    province: stop.address.region ?? '',
    country: 'South Africa',
    countryCode: stop.address.countryCode,
    latitude: String(stop.geo.lat),
    longitude: String(stop.geo.lng),
    contact: stop.phone || null,
    email,
  };
}

function toPlanOrder(
  order: TransportOrder,
  fulfilment: Fulfilment | null,
  destinationRef: string,
): EpodPlanOrder {
  const part = fulfilment?.parts.find((p) => p.id === order.partId) ?? null;
  const items = (part?.lines ?? []).map((line, i) => {
    const picked = part?.lineResults?.find((r) => r.externalLineRef === line.externalLineRef);
    return {
      itemNumber: String(i + 1),
      reference: line.sku,
      packingUnitFlag: false,
      plannedItemQuantity: picked?.pickedQuantity ?? line.quantity,
      plannedItemUom: 'EA',
    };
  });
  return {
    orderNumber: order.id,
    displayNumber: order.shortId,
    createdAt: order.createdAt.toISOString(),
    sourceLocationReference: order.originRef,
    destinationLocationReference: destinationRef,
    serviceDate: SERVICE_DATE_FORMAT.format(order.window.slotStart),
    plannedWeight: 0,
    plannedWeightUom: 'kg',
    actualWeight: 0,
    actualWeightUom: 'kg',
    planningStatus: 'Ready',
    items: items.filter((i) => i.plannedItemQuantity > 0),
    subOrders: [],
  };
}

export interface RoutePlanInput {
  readonly trip: Trip;
  /** Member orders, keyed by id (the trip's stop sequence drives order). */
  readonly ordersById: ReadonlyMap<string, TransportOrder>;
  /** Fulfilments for item lines + destination refs, keyed by fulfilment id. */
  readonly fulfilmentsById: ReadonlyMap<string, Fulfilment>;
  readonly context: EpodPlanContext;
  readonly now: Date;
}

export function toEpodRoutePlan(input: RoutePlanInput): EpodRoutePlan {
  const { trip, ordersById, fulfilmentsById, context, now } = input;
  const driver = { reference: trip.driverRef };

  const members = trip.stops
    .map((stop) => {
      const order = ordersById.get(stop.orderId);
      if (!order) return null;
      const fulfilment = fulfilmentsById.get(order.fulfilmentId) ?? null;
      const destinationRef = fulfilment
        ? epodDestinationReference(fulfilment.destination, fulfilment.id)
        : `fulfilgo-dest-${order.fulfilmentId}`;
      return { stop, order, fulfilment, destinationRef };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  // Timeline: collect everything at the store now, then drive the sequence.
  let cursor = now.getTime();
  const pickArrival = new Date(cursor).toISOString();
  cursor += STOP_SERVICE_MINUTES * 60_000;
  const pickDeparture = new Date(cursor).toISOString();

  const pickStop: EpodPlanStop = {
    reference: `${trip.id}-S1`,
    sequence: 1,
    stopType: 'Pick',
    diversionBlock: false,
    qrCode: trip.id,
    arrivalAt: pickArrival,
    departureAt: pickDeparture,
    distanceFromPrevious: 0,
    minutesFromPrevious: 0,
    instruction: null,
    locationReference: trip.originRef,
    workflowType: null,
    driver,
    orders: members.map((m) => ({ orderNumber: m.order.id })),
  };

  const dropStops: EpodPlanStop[] = members.map((m, i) => {
    const legMinutes = m.stop.legMinutes ?? FALLBACK_LEG_MINUTES;
    const legKm = m.stop.legKm ?? FALLBACK_LEG_KM;
    cursor += legMinutes * 60_000;
    const arrivalAt = new Date(cursor).toISOString();
    cursor += STOP_SERVICE_MINUTES * 60_000;
    const departureAt = new Date(cursor).toISOString();
    return {
      reference: `${trip.id}-S${i + 2}`,
      sequence: i + 2,
      stopType: 'Drop',
      diversionBlock: false,
      qrCode: m.order.shortId,
      arrivalAt,
      departureAt,
      distanceFromPrevious: legKm,
      minutesFromPrevious: legMinutes,
      instruction: m.order.destination.instructions ?? null,
      locationReference: m.destinationRef,
      workflowType: null,
      driver,
      orders: [{ orderNumber: m.order.id }],
    };
  });

  const routeKm = trip.routeKm ?? dropStops.reduce((sum, s) => sum + s.distanceFromPrevious, 0);
  const routeMinutes =
    trip.routeMinutes ??
    dropStops.reduce((sum, s) => sum + s.minutesFromPrevious + STOP_SERVICE_MINUTES, 0) +
      STOP_SERVICE_MINUTES;
  const startAt = pickArrival;
  const endAt = dropStops.at(-1)?.departureAt ?? pickDeparture;

  const locations = members
    .map((m) =>
      toPlanLocation(
        m.destinationRef,
        m.order.destination,
        'Customer',
        m.fulfilment?.destination.location.contact?.email ?? null,
      ),
    )
    .filter((l): l is EpodPlanLocation => l !== null);
  // One destination can back multiple parts of one fulfilment — dedupe.
  const uniqueLocations = [...new Map(locations.map((l) => [l.reference, l])).values()];

  const products = new Map<string, { reference: string; name: string }>();
  for (const m of members) {
    const part = m.fulfilment?.parts.find((p) => p.id === m.order.partId);
    for (const line of part?.lines ?? []) {
      if (!products.has(line.sku))
        products.set(line.sku, { reference: line.sku, name: line.description });
    }
  }

  return {
    company: {
      reference: context.companyReference,
      name: context.companyName,
      routes: [
        {
          reference: trip.id,
          name: trip.id,
          startAt,
          endAt,
          distance: routeKm,
          minutes: Math.ceil(routeMinutes),
          depot: { reference: trip.depotRef ?? trip.originRef },
          territory: { reference: trip.territoryRef ?? '' },
          transporter: { reference: context.transporterReference },
          vehicle: { registrationNumber: trip.vehicleRef },
          vehicleType: { reference: context.vehicleTypeReference },
          trips: [
            {
              reference: `${trip.id}-T1`,
              name: `${trip.id}-T1`,
              tripType: 'Last Mile',
              terms: 'external',
              agent: 'FulfilGo',
              sequence: 1,
              startAt,
              endAt,
              distance: routeKm,
              minutes: Math.ceil(routeMinutes),
              notificationLevel: 'order',
              orderType: 'On Demand',
              planningStatus: 'Ready',
              stops: [pickStop, ...dropStops],
            },
          ],
          orders: members.map((m) => toPlanOrder(m.order, m.fulfilment, m.destinationRef)),
          masterdata: {
            company: [{ reference: context.companyReference, name: context.companyName }],
            drivers: null,
            vehicles: [
              {
                registrationNumber: trip.vehicleRef,
                fleetNumber: trip.vehicleRef,
                vehicleTypeReference: context.vehicleTypeReference,
              },
            ],
            vehicleTypes: [
              {
                reference: context.vehicleTypeReference,
                name: context.vehicleTypeName,
                maxWeight: context.vehicleTypeMaxWeightKg,
                maxWeightUom: 'KG',
              },
            ],
            transporters: [
              { reference: context.transporterReference, name: context.transporterName },
            ],
            locations: uniqueLocations,
            products: [...products.values()],
          },
        },
      ],
    },
  };
}
