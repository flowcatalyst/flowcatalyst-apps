/**
 * Uber Direct end-to-end smoke against YOUR TEST CREDENTIALS (live_mode
 * must come back false — no billing, no real couriers). Exercises the full
 * adapter path: quote → create delivery with the Robo Courier ('auto' mode
 * walks assigned → enroute → pickup → dropoff → delivered at 30s steps) →
 * poll to terminal.
 *
 *   UBER_CLIENT_ID=… UBER_CLIENT_SECRET=… UBER_CUSTOMER_ID=cus_… \
 *     pnpm tsx scripts/uber-smoke.ts
 *
 * Optional: UBER_PICKUP_PHONE / UBER_DROPOFF_PHONE (E.164) if your test org
 * validates numbers strictly.
 */
import { createUberAdapter } from '../src/transport/uber/adapter.js';

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} — set UBER_CLIENT_ID, UBER_CLIENT_SECRET, UBER_CUSTOMER_ID.`);
    process.exit(1);
  }
  return value;
}

const adapter = createUberAdapter({
  clientId: env('UBER_CLIENT_ID'),
  clientSecret: env('UBER_CLIENT_SECRET'),
  customerId: env('UBER_CUSTOMER_ID'),
  testSpecifications: { mode: 'auto' },
  obfuscateManifest: true,
});

// Robo courier ignores geography ("teleports"), but the QUOTE is still real
// serviceability logic — use a plausible US metro address for test orgs.
const origin = {
  name: 'FulfilGo Test Store',
  address: {
    line1: '100 Maiden Ln',
    city: 'New York',
    region: 'NY',
    postalCode: '10038',
    countryCode: 'US',
  },
  geo: { lat: 40.706, lng: -74.007 },
  phone: process.env['UBER_PICKUP_PHONE'] ?? '+15555555555',
  instructions: 'Goods receiving door.',
};
const destination = {
  name: 'Test Customer',
  address: {
    line1: '30 Rockefeller Plaza',
    city: 'New York',
    region: 'NY',
    postalCode: '10112',
    countryCode: 'US',
  },
  geo: { lat: 40.759, lng: -73.979 },
  phone: process.env['UBER_DROPOFF_PHONE'] ?? '+15555555556',
};

const now = new Date();
const window = {
  // Slot "already started" → adapter clamps pickup_ready to now (house rule:
  // never before slot start; here slot start is in the past).
  slotStart: new Date(now.getTime() - 5 * 60_000),
  slotEnd: new Date(now.getTime() + 60 * 60_000),
};

const quote = await adapter.quote({ origin, destination, window, declaredValueCents: 12_500 });
console.log('QUOTE:', quote);
if (!quote.accepted) process.exit(2);

const delivery = await adapter.createDelivery({
  origin,
  destination,
  window,
  declaredValueCents: 12_500,
  providerQuoteRef: quote.providerQuoteRef,
  parcels: [
    { ref: 'BAG-TEST-1', kind: 'bag', size: 'M', temperature: 'ambient', description: 'Bag M' },
    { ref: 'BAG-TEST-2', kind: 'bag', size: 'XL', temperature: 'frozen', description: 'Bag XL' },
  ],
  requiresVehicle: true,
  externalRef: `smoke-${now.getTime().toString(36)}`,
  idempotencyKey: `smoke-${now.getTime().toString(36)}`,
});
console.log('CREATED:', delivery);
if (delivery.liveMode !== false) {
  console.error('⚠️  live_mode is not false — these are NOT test credentials. Aborting poll.');
  process.exit(3);
}

let last = delivery.status;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 15_000));
  const current = await adapter.getDelivery(delivery.providerRef);
  if (current.status !== last) {
    console.log(`STATUS: ${last} → ${current.status}`, current.courier ?? '');
    last = current.status;
  }
  if (
    current.status === 'delivered' ||
    current.status === 'failed' ||
    current.status === 'cancelled'
  ) {
    console.log('TERMINAL:', current.status, '· tracking:', current.trackingUrl);
    process.exit(0);
  }
}
console.error('Timed out waiting for terminal status (robo courier should finish in ~3 min).');
process.exit(4);
