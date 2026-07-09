/**
 * Regenerates the fulfilment-generator sample data:
 *   src/generator/data/stores.json    — 100 stores across major SA cities
 *   src/generator/data/products.json  — 1000 products with temperature classes
 *
 * These are GENERATOR-ONLY fixtures (fake stores/products for producing test
 * fulfilments) — not master data. Seeded PRNG keeps output stable across runs.
 *
 *   node scripts/generate-sample-data.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/generator/data');

// mulberry32 — tiny seeded PRNG, good enough for fixtures.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(20260709);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);

// ── Stores ────────────────────────────────────────────────────────────────────
// Major SA cities, weighted roughly by size. Store coords jitter within ~12km
// of the city centre.
const CITIES = [
  { name: 'Johannesburg', region: 'Gauteng', lat: -26.2041, lng: 28.0473, weight: 22 },
  { name: 'Cape Town', region: 'Western Cape', lat: -33.9249, lng: 18.4241, weight: 20 },
  { name: 'Durban', region: 'KwaZulu-Natal', lat: -29.8587, lng: 31.0218, weight: 14 },
  { name: 'Pretoria', region: 'Gauteng', lat: -25.7479, lng: 28.2293, weight: 12 },
  { name: 'Gqeberha', region: 'Eastern Cape', lat: -33.9608, lng: 25.6022, weight: 8 },
  { name: 'Bloemfontein', region: 'Free State', lat: -29.0852, lng: 26.1596, weight: 6 },
  { name: 'East London', region: 'Eastern Cape', lat: -33.0292, lng: 27.8546, weight: 5 },
  { name: 'Pietermaritzburg', region: 'KwaZulu-Natal', lat: -29.6006, lng: 30.3794, weight: 4 },
  { name: 'Polokwane', region: 'Limpopo', lat: -23.9045, lng: 29.4689, weight: 3 },
  { name: 'Mbombela', region: 'Mpumalanga', lat: -25.4753, lng: 30.9694, weight: 3 },
  { name: 'Kimberley', region: 'Northern Cape', lat: -28.7282, lng: 24.7499, weight: 2 },
  { name: 'George', region: 'Western Cape', lat: -33.963, lng: 22.4617, weight: 1 },
];
const CHAINS = ['FreshMart', 'QuickShop', 'DailyGrocer', 'MetroFoods', 'GreenBasket'];
const STREETS = [
  'Main Road',
  'Church Street',
  'Long Street',
  'Voortrekker Road',
  'Beach Road',
  'Oxford Street',
  'Jan Smuts Avenue',
  'Rivonia Road',
  'Umhlanga Rocks Drive',
  'Kloof Street',
];

/** Random point within `km` of (lat, lng) — uniform over the disk. */
function jitter(lat, lng, km) {
  const r = km * Math.sqrt(rand());
  const theta = rand() * 2 * Math.PI;
  const dLat = (r / 111.32) * Math.cos(theta);
  const dLng = ((r / 111.32) * Math.sin(theta)) / Math.cos((lat * Math.PI) / 180);
  return { lat: +(lat + dLat).toFixed(6), lng: +(lng + dLng).toFixed(6) };
}

const cityPool = CITIES.flatMap((c) => Array.from({ length: c.weight }, () => c));
const stores = Array.from({ length: 100 }, (_, i) => {
  const n = i + 1;
  const city = cityPool[Math.floor(rand() * cityPool.length)];
  const chain = pick(CHAINS);
  const geo = jitter(city.lat, city.lng, 12);
  const ref = `store-${String(n).padStart(3, '0')}`;
  return {
    ref,
    name: `${chain} ${city.name} ${n}`,
    chain,
    city: city.name,
    region: city.region,
    address: {
      line1: `${Math.floor(between(1, 400))} ${pick(STREETS)}`,
      city: city.name,
      region: city.region,
      postalCode: String(Math.floor(between(1000, 9999))),
      countryCode: 'ZA',
    },
    geo,
    contact: { phone: `+27${Math.floor(between(600000000, 899999999))}` },
    instructions: pick([
      'Collection at the back-of-store dispatch counter.',
      'Ring the bell at goods receiving.',
      'Ask for the online-orders desk at customer service.',
      'Parking bay 1-3 reserved for collections.',
    ]),
    collectionPoint: {
      ref: `cp-${ref}`,
      name: `${chain} ${city.name} ${n} Collection Point`,
    },
  };
});

// ── Products ──────────────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    temperatureClass: 'frozen',
    share: 0.15,
    weight: [200, 2500],
    items: [
      'Ice Cream',
      'Frozen Peas',
      'Frozen Pizza',
      'Fish Fingers',
      'Frozen Berries',
      'Frozen Chips',
      'Ice Lollies',
      'Frozen Pastry',
    ],
  },
  {
    temperatureClass: 'refrigerated',
    share: 0.3,
    weight: [100, 3000],
    items: [
      'Full Cream Milk',
      'Cheddar Cheese',
      'Greek Yoghurt',
      'Butter',
      'Chicken Breasts',
      'Beef Mince',
      'Ham Slices',
      'Fresh Cream',
      'Boerewors',
      'Feta',
      'Salmon Portions',
      'Custard',
    ],
  },
  {
    temperatureClass: 'normal',
    share: 0.55,
    weight: [50, 5000],
    items: [
      'Basmati Rice',
      'Spaghetti',
      'Tomato Sauce',
      'Peanut Butter',
      'Rooibos Tea',
      'Ground Coffee',
      'Sunflower Oil',
      'Cake Flour',
      'White Sugar',
      'Baked Beans',
      'Corn Flakes',
      'Dishwashing Liquid',
      'Toilet Paper',
      'Sparkling Water',
      'Orange Juice',
      'Dark Chocolate',
      'Salted Peanuts',
      'Rusks',
      'Chutney',
      'Braai Spice',
    ],
  },
];
const BRANDS = [
  'Karoo',
  'Highveld',
  'Two Oceans',
  'Msanzi',
  'Golden Hour',
  'Table Mountain',
  'Jozi',
  'Winelands',
];
const SIZES = [
  '250g',
  '400g',
  '500g',
  '750g',
  '1kg',
  '2kg',
  '330ml',
  '500ml',
  '1L',
  '2L',
  '6-pack',
];

const products = [];
for (let i = 0; i < 1000; i++) {
  const roll = rand();
  const category =
    roll < CATEGORIES[0].share
      ? CATEGORIES[0]
      : roll < CATEGORIES[0].share + CATEGORIES[1].share
        ? CATEGORIES[1]
        : CATEGORIES[2];
  const item = pick(category.items);
  const brand = pick(BRANDS);
  const size = pick(SIZES);
  const weightGrams = Math.round(between(category.weight[0], category.weight[1]));
  products.push({
    sku: `PRD-${String(i + 1).padStart(5, '0')}`,
    gtin: `600${String(Math.floor(rand() * 1e10)).padStart(10, '0')}`,
    description: `${brand} ${item} ${size}`,
    temperatureClass: category.temperatureClass,
    volumetric: {
      weightGrams,
      lengthMm: Math.round(between(50, 400)),
      widthMm: Math.round(between(50, 300)),
      heightMm: Math.round(between(20, 350)),
    },
  });
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'stores.json'), JSON.stringify(stores, null, 2) + '\n');
writeFileSync(join(OUT_DIR, 'products.json'), JSON.stringify(products, null, 2) + '\n');
console.log(`wrote ${stores.length} stores and ${products.length} products to ${OUT_DIR}`);
