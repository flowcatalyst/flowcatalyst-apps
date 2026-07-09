import type { CreateFulfilmentCommand } from '@fulfil-go/shared';
import stores from '../generator/data/stores.json';
import products from '../generator/data/products.json';

/**
 * Fulfilment generator — builds realistic create-fulfilment payloads from
 * the committed sample fixtures (100 SA stores, 1000 products). Generator-
 * only: the stores/products are fake and exist purely to exercise the
 * fulfilment context.
 */
export interface GeneratorOptions {
  /** 0..1 share of deliveries (rest are collections). */
  readonly deliveryShare: number;
  /** 0..1 share of ASAP among deliveries (collections are STANDARD). */
  readonly asapShare: number;
  /** 0..1 share of two-store (multi-part) fulfilments. */
  readonly multiStoreShare: number;
}

export const DEFAULT_OPTIONS: GeneratorOptions = {
  deliveryShare: 0.7,
  asapShare: 0.4,
  multiStoreShare: 0.2,
};

type Store = (typeof stores)[number];
type Product = (typeof products)[number];

const FIRST_NAMES = [
  'Thandi',
  'Sipho',
  'Anika',
  'Pieter',
  'Lerato',
  'Johan',
  'Zanele',
  'Priya',
  'Kagiso',
  'Emma',
];
const LAST_NAMES = [
  'Nkosi',
  'van der Merwe',
  'Dlamini',
  'Botha',
  'Naidoo',
  'Mokoena',
  'Smith',
  'Khumalo',
  'Pillay',
  'Fourie',
];

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Random point within `km` of (lat, lng) — uniform over the disk. */
export function randomPointNear(
  lat: number,
  lng: number,
  km: number,
): { lat: number; lng: number } {
  const r = km * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  const dLat = (r / 111.32) * Math.cos(theta);
  const dLng = ((r / 111.32) * Math.sin(theta)) / Math.cos((lat * Math.PI) / 180);
  return { lat: +(lat + dLat).toFixed(6), lng: +(lng + dLng).toFixed(6) };
}

function sampleProducts(count: number): Product[] {
  const chosen = new Set<number>();
  while (chosen.size < count) chosen.add(Math.floor(Math.random() * products.length));
  return [...chosen].map((i) => products[i]!);
}

function buildPart(store: Store): CreateFulfilmentCommand['parts'][number] {
  const lines = sampleProducts(Math.floor(between(1, 7))).map((product, index) =>
    Object.assign(
      {
        externalLineRef: `L${index + 1}`,
        sku: product.sku,
        gtin: product.gtin,
        description: product.description,
        quantity: Math.floor(between(1, 5)),
        volumetric: product.volumetric,
        temperatureClass: product.temperatureClass as 'normal' | 'refrigerated' | 'frozen',
      },
      Math.random() < 0.1 ? { allowSubstitutes: false } : {},
    ),
  );
  return {
    origin: {
      ref: store.ref,
      name: store.name,
      address: store.address,
      geo: store.geo,
      contact: store.contact,
      instructions: store.instructions,
    },
    lines,
  };
}

/** Pick 1 (or 2 for multi-store) stores in the SAME city — on-demand is local. */
function pickStores(multiStore: boolean): Store[] {
  const first = pick(stores);
  if (!multiStore) return [first];
  const sameCity = stores.filter((s) => s.city === first.city && s.ref !== first.ref);
  return sameCity.length > 0 ? [first, pick(sameCity)] : [first];
}

export function buildFulfilment(
  clientId: string,
  externalRef: string,
  options: GeneratorOptions = DEFAULT_OPTIONS,
): CreateFulfilmentCommand {
  const isDelivery = Math.random() < options.deliveryShare;
  const serviceLevel = isDelivery && Math.random() < options.asapShare ? 'ASAP' : 'STANDARD';
  const chosenStores = pickStores(Math.random() < options.multiStoreShare);
  const anchor = chosenStores[0]!;

  // ASAP: a near-now window; STANDARD: a 2h slot tomorrow morning/afternoon.
  const now = Date.now();
  const slotStart =
    serviceLevel === 'ASAP'
      ? new Date(now + 30 * 60_000)
      : new Date(now + 24 * 3600_000 + Math.floor(between(0, 8)) * 3600_000);
  const slotEnd = new Date(slotStart.getTime() + (serviceLevel === 'ASAP' ? 60 : 120) * 60_000);

  const customer = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const destination: CreateFulfilmentCommand['destination'] = isDelivery
    ? {
        kind: 'delivery',
        location: {
          name: customer,
          // Drop-off within 5km of the (anchor) store.
          geo: randomPointNear(anchor.geo.lat, anchor.geo.lng, 5),
          address: {
            line1: `${Math.floor(between(1, 300))} ${pick(['Oak', 'Protea', 'Marula', 'Acacia', 'Camelia'])} ${pick(['Street', 'Avenue', 'Close', 'Road'])}`,
            city: anchor.city,
            region: anchor.region,
            countryCode: 'ZA',
          },
          contact: { name: customer, phone: `+27${Math.floor(between(600000000, 899999999))}` },
        },
      }
    : {
        kind: 'collect',
        collectionPointRef: anchor.collectionPoint.ref,
        location: {
          ref: anchor.collectionPoint.ref,
          name: anchor.collectionPoint.name,
          address: anchor.address,
          geo: anchor.geo,
          instructions: anchor.instructions,
        },
      };

  return {
    clientId,
    externalSource: 'generator',
    externalRef,
    type: isDelivery ? 'delivery' : 'collect',
    serviceLevel,
    slotStart: slotStart.toISOString(),
    slotEnd: slotEnd.toISOString(),
    timezone: 'Africa/Johannesburg',
    destination,
    policies: {
      allowSubstitutes: Math.random() < 0.9,
      allowPartialFulfilment: Math.random() < 0.8,
    },
    additionalData: { generatedBy: 'fulfilment-generator', customer },
    parts: chosenStores.map(buildPart),
  };
}
