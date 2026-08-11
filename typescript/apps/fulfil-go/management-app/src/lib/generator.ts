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
  /**
   * Anchor every fulfilment to this store (empty/undefined = random).
   * Multi-store fulfilments still add a same-city partner store.
   */
  readonly storeRef?: string;
  /**
   * STANDARD slots start on a WHOLE hour within this many hours from now
   * (e.g. 3 → 16:00/17:00/18:00 when generating at 15:20). ASAP is always
   * near-now and ignores this.
   */
  readonly slotWindowHours: number;
}

export const DEFAULT_OPTIONS: GeneratorOptions = {
  deliveryShare: 0.7,
  asapShare: 0.4,
  multiStoreShare: 0.2,
  slotWindowHours: 3,
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

/**
 * Deterministic per-(store, sku) shelf location — the same product always
 * sits in the same aisle at a given store. Zero-padded so lexicographic sort
 * = walk order; a real integration would pass slotting/planogram data here.
 */
function locationFor(storeRef: string, sku: string) {
  let h = 0;
  const key = `${storeRef}:${sku}`;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const aisleNo = 1 + (h % 24);
  const bayNo = 1 + ((h >>> 5) % 6);
  const shelfNo = 1 + ((h >>> 9) % 5);
  const positionIndex = 1 + ((h >>> 12) % 8);
  const aisle = `A${String(aisleNo).padStart(2, '0')}`;
  const bay = `B${bayNo}`;
  const shelf = `S${shelfNo}`;
  return {
    aisle,
    bay,
    shelf,
    positionIndex,
    // Serpentine store walk: odd aisles walked B1→B6, even aisles B6→B1.
    walkSequence: aisleNo * 100 + (aisleNo % 2 === 1 ? bayNo : 7 - bayNo) * 10 + shelfNo,
    locationDisplay: `${aisle}·${bay}·${shelf}`,
  };
}

function buildPart(store: Store): CreateFulfilmentCommand['parts'][number] {
  const lines = sampleProducts(Math.floor(between(1, 7))).map((product, index) =>
    Object.assign(
      {
        externalLineRef: `L${index + 1}`,
        sku: product.sku,
        gtin: product.gtin,
        description: product.description,
        // Seeded per-sku placeholder image (offline: the app falls back).
        imageUrl: `https://picsum.photos/seed/${product.sku}/96/96`,
        quantity: Math.floor(between(1, 5)),
        volumetric: product.volumetric,
        temperatureClass: product.temperatureClass as 'ambient' | 'chilled' | 'frozen',
        // Liquor fixtures carry 18 — drives the delivery age-check flow.
        ...((product as { restrictedMinAge?: number }).restrictedMinAge
          ? { restrictedMinAge: (product as { restrictedMinAge?: number }).restrictedMinAge }
          : {}),
        location: locationFor(store.ref, product.sku),
        // Legacy aisle attribute kept for back-compat display fallbacks.
        attributes: { aisle: locationFor(store.ref, product.sku).locationDisplay },
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

/**
 * Pick 1 (or 2 for multi-store) stores in the SAME city — on-demand is local.
 * `anchorRef` pins the first store (generate-for-this-store mode).
 */
function pickStores(multiStore: boolean, anchorRef?: string): Store[] {
  const anchored = anchorRef ? stores.find((s) => s.ref === anchorRef) : undefined;
  const first = anchored ?? pick(stores);
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
  const chosenStores = pickStores(Math.random() < options.multiStoreShare, options.storeRef);
  const anchor = chosenStores[0]!;

  // ASAP: a near-now window; STANDARD: a 2h slot starting on a WHOLE hour
  // within the configured window (16:00-style, not 16:23).
  const now = Date.now();
  const nextWholeHour = Math.ceil(now / 3600_000) * 3600_000;
  const windowHours = Math.max(1, Math.floor(options.slotWindowHours));
  const slotStart =
    serviceLevel === 'ASAP'
      ? new Date(now + 30 * 60_000)
      : new Date(nextWholeHour + Math.floor(between(0, windowHours)) * 3600_000);
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
