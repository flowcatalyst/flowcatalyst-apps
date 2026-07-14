import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { TransportBookingRequest, TransportQuoteRequest } from '../provider-port.js';
import {
  BAG_SIZE_TO_UBER,
  createUberAdapter,
  normalizeUberStatus,
  pickupDeadlineAt,
  pickupReadyAt,
  toManifestItems,
  toUberAddress,
  toUberPhone,
} from './adapter.js';
import { UberApiError, type UberClient } from './client.js';
import { toStatusUpdate, verifyUberSignature } from './webhook.js';
import type { UberCreateDeliveryRequest, UberDeliveryResponse, UberWebhookEvent } from './types.js';

const NOW = new Date('2026-07-11T08:00:00Z');

const ORIGIN = {
  name: 'MetroFoods Bloem 1',
  address: {
    line1: '216 Rivonia Road',
    suburb: 'Westdene',
    city: 'Bloemfontein',
    region: 'Free State',
    postalCode: '1698',
    countryCode: 'ZA',
  },
  geo: { lat: -29.157793, lng: 26.226187 },
  phone: '+27 87 759-5214',
  instructions: 'Ring the bell at goods receiving.',
};

const DESTINATION = {
  name: 'T. Nkosi',
  address: { line1: '12 Oak Ave', city: 'Bloemfontein', countryCode: 'ZA' },
  geo: { lat: -29.16, lng: 26.23 },
  phone: '0837759214',
};

function quoteRequest(overrides: Partial<TransportQuoteRequest> = {}): TransportQuoteRequest {
  return {
    origin: ORIGIN,
    destination: DESTINATION,
    window: {
      slotStart: new Date('2026-07-11T09:00:00Z'),
      slotEnd: new Date('2026-07-11T10:00:00Z'),
    },
    declaredValueCents: 45_000,
    ...overrides,
  };
}

function bookingRequest(overrides: Partial<TransportBookingRequest> = {}): TransportBookingRequest {
  return {
    ...quoteRequest(),
    parcels: [
      {
        ref: 'BAG-001',
        kind: 'bag',
        size: 'M',
        temperature: 'ambient',
        description: 'Bag M · ambient',
      },
      {
        ref: 'BAG-002',
        kind: 'bag',
        size: 'L',
        temperature: 'chilled',
        description: 'Bag L · chilled',
      },
    ],
    requiresCarOrLarger: false,
    externalRef: 'ful_X-1234',
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

function stubClient(overrides: Partial<UberClient> = {}): UberClient {
  return {
    createQuote: vi.fn(),
    createDelivery: vi.fn(),
    getDelivery: vi.fn(),
    cancelDelivery: vi.fn(),
    ...overrides,
  };
}

const DELIVERY_RESPONSE: UberDeliveryResponse = {
  kind: 'delivery',
  id: 'del_123',
  status: 'pending',
  complete: false,
  courier: null,
  tracking_url: 'https://track',
  fee: 5400,
  currency: 'zar',
  live_mode: false,
};

describe('pickup window rules', () => {
  it('pickup_ready is the slot start when the slot is in the future — NEVER earlier', () => {
    const window = {
      slotStart: new Date('2026-07-11T09:00:00Z'),
      slotEnd: new Date('2026-07-11T10:00:00Z'),
    };
    expect(pickupReadyAt(window, NOW).toISOString()).toBe('2026-07-11T09:00:00.000Z');
  });

  it('clamps pickup_ready to now when the slot already started (Uber rejects past times)', () => {
    const window = {
      slotStart: new Date('2026-07-11T07:00:00Z'),
      slotEnd: new Date('2026-07-11T10:00:00Z'),
    };
    expect(pickupReadyAt(window, NOW).toISOString()).toBe(NOW.toISOString());
  });

  it('floors the deadline to ready+10min and now+20min', () => {
    const tight = {
      slotStart: new Date('2026-07-11T08:05:00Z'),
      slotEnd: new Date('2026-07-11T08:10:00Z'),
    };
    const ready = pickupReadyAt(tight, NOW);
    // slotEnd 08:10 < ready+10 (08:15) < now+20 (08:20) → 08:20
    expect(pickupDeadlineAt(tight, ready, NOW).toISOString()).toBe('2026-07-11T08:20:00.000Z');
  });
});

describe('mapping', () => {
  it('stringifies addresses in Uber wire format', () => {
    expect(JSON.parse(toUberAddress(ORIGIN))).toEqual({
      street_address: ['216 Rivonia Road', 'Westdene'],
      city: 'Bloemfontein',
      state: 'Free State',
      zip_code: '1698',
      country: 'ZA',
    });
  });

  it('normalizes phones to ^\\+digits$ and rejects garbage', () => {
    expect(toUberPhone('+27 87 759-5214')).toBe('+27877595214');
    expect(toUberPhone('0837759214')).toBe('+0837759214');
    expect(() => toUberPhone('call me')).toThrow(/E.164/);
  });

  it('maps captured bag sizes onto Uber manifest sizes', () => {
    expect(BAG_SIZE_TO_UBER).toEqual({
      XS: 'small',
      S: 'small',
      M: 'medium',
      L: 'large',
      XL: 'xlarge',
    });
    const items = toManifestItems(bookingRequest().parcels, false);
    expect(items.map((i) => i.size)).toEqual(['medium', 'large']);
    expect(items.map((i) => i.name)).toEqual(['Bag M · ambient', 'Bag L · chilled']);
  });

  it('requiresCarOrLarger promotes the largest parcel to xlarge (best-effort nudge)', () => {
    const items = toManifestItems(bookingRequest().parcels, true);
    expect(items.map((i) => i.size)).toEqual(['medium', 'xlarge']);
  });

  it('obfuscated manifests expose only package refs, never contents', () => {
    const items = toManifestItems(bookingRequest().parcels, false, true);
    expect(items.map((i) => i.name)).toEqual(['BAG-001', 'BAG-002']);
  });

  it('normalizes every Uber status onto the port status machine', () => {
    expect(normalizeUberStatus('pending')).toBe('booked');
    expect(normalizeUberStatus('pickup')).toBe('assigned');
    expect(normalizeUberStatus('pickup_complete')).toBe('collected');
    expect(normalizeUberStatus('dropoff')).toBe('collected');
    expect(normalizeUberStatus('delivered')).toBe('delivered');
    expect(normalizeUberStatus('canceled')).toBe('cancelled');
    expect(normalizeUberStatus('returned')).toBe('failed');
  });
});

describe('adapter', () => {
  const CONFIG = { clientId: 'c', clientSecret: 's', customerId: 'cus_1' };

  it('quotes with pickup_ready_dt = slot start and classifies acceptance', async () => {
    const createQuote = vi.fn().mockResolvedValue({
      kind: 'delivery_quote',
      id: 'dqt_1',
      created: '2026-07-11T08:00:00Z',
      expires: '2026-07-11T08:15:00Z',
      fee: 5400,
      currency_type: 'ZAR',
      dropoff_eta: '2026-07-11T09:40:00Z',
      pickup_duration: 12,
    });
    const adapter = createUberAdapter(CONFIG, stubClient({ createQuote }), () => NOW);

    const outcome = await adapter.quote(quoteRequest());
    expect(outcome).toMatchObject({
      accepted: true,
      providerQuoteRef: 'dqt_1',
      feeCents: 5400,
      currency: 'ZAR',
    });
    const sent = createQuote.mock.calls[0]![0];
    expect(sent.pickup_ready_dt).toBe('2026-07-11T09:00:00.000Z'); // slot start, not now
    expect(sent.pickup_deadline_dt).toBe('2026-07-11T10:00:00.000Z');
    expect(sent.manifest_total_value).toBe(45_000);
    expect(sent.pickup_phone_number).toBe('+27877595214');
  });

  it('classifies serviceability / window / capacity rejections for the resolver', async () => {
    const cases: Array<[number, string, string]> = [
      [400, 'address_undeliverable', 'not_serviceable'],
      [400, 'pickup_ready_too_early', 'window_invalid'],
      [503, 'couriers_busy', 'capacity'],
      [500, 'internal_server_error', 'other'],
    ];
    for (const [status, code, reason] of cases) {
      const createQuote = vi.fn().mockRejectedValue(new UberApiError(status, code, 'nope'));
      const adapter = createUberAdapter(CONFIG, stubClient({ createQuote }), () => NOW);
      expect(await adapter.quote(quoteRequest())).toMatchObject({
        accepted: false,
        reason,
        providerCode: code,
      });
    }
  });

  it('creates deliveries with manifest from bag sizes + robo courier only when configured', async () => {
    const createDelivery = vi.fn().mockResolvedValue(DELIVERY_RESPONSE);
    const adapter = createUberAdapter(
      { ...CONFIG, testSpecifications: { mode: 'auto' }, obfuscateManifest: true },
      stubClient({ createDelivery }),
      () => NOW,
    );

    const delivery = await adapter.createDelivery(bookingRequest({ providerQuoteRef: 'dqt_1' }));
    expect(delivery).toMatchObject({ providerRef: 'del_123', status: 'booked', liveMode: false });

    const sent = createDelivery.mock.calls[0]![0] as UberCreateDeliveryRequest;
    expect(sent.quote_id).toBe('dqt_1');
    expect(sent.manifest_items.map((i) => i.name)).toEqual(['BAG-001', 'BAG-002']);
    expect(sent.test_specifications).toEqual({ robo_courier_specification: { mode: 'auto' } });
    expect(sent.idempotency_key).toBe('idem-1');
    expect(sent.external_id).toBe('ful_X-1234');
    expect(sent.undeliverable_action).toBe('return');

    // No test specs when not configured (production path).
    const prodCreate = vi.fn().mockResolvedValue(DELIVERY_RESPONSE);
    await createUberAdapter(
      CONFIG,
      stubClient({ createDelivery: prodCreate }),
      () => NOW,
    ).createDelivery(bookingRequest());
    expect(
      (prodCreate.mock.calls[0]![0] as UberCreateDeliveryRequest).test_specifications,
    ).toBeUndefined();
  });

  it('recovers a duplicate_delivery 409 by fetching the existing delivery', async () => {
    const createDelivery = vi
      .fn()
      .mockRejectedValue(
        new UberApiError(409, 'duplicate_delivery', 'dup', { delivery_id: 'del_existing' }),
      );
    const getDelivery = vi.fn().mockResolvedValue({ ...DELIVERY_RESPONSE, id: 'del_existing' });
    const adapter = createUberAdapter(
      CONFIG,
      stubClient({ createDelivery, getDelivery }),
      () => NOW,
    );

    const delivery = await adapter.createDelivery(bookingRequest());
    expect(delivery.providerRef).toBe('del_existing');
    expect(getDelivery).toHaveBeenCalledWith('del_existing');
  });
});

describe('webhooks', () => {
  const KEY = 'signing-key';
  const EVENT: UberWebhookEvent = {
    id: 'evt_1',
    kind: 'event.delivery_status',
    status: 'dropoff',
    created: '2026-07-11T09:30:00Z',
    customer_id: 'cus_1',
    delivery_id: 'del_123',
    live_mode: false,
    data: {
      ...DELIVERY_RESPONSE,
      status: 'dropoff',
      courier: { name: 'R. Robot', vehicle_type: 'car' },
    },
  };

  it('verifies the lowercase-hex HMAC-SHA256 signature over the raw body', () => {
    const raw = JSON.stringify(EVENT);
    const good = createHmac('sha256', KEY).update(raw).digest('hex');
    expect(verifyUberSignature(raw, good, KEY)).toBe(true);
    expect(verifyUberSignature(raw, good.toUpperCase(), KEY)).toBe(true); // header case-insensitivity
    expect(verifyUberSignature(raw, 'deadbeef', KEY)).toBe(false);
    expect(verifyUberSignature(`${raw} `, good, KEY)).toBe(false); // raw-body sensitivity
  });

  it('normalizes events onto the port status machine', () => {
    const update = toStatusUpdate(EVENT);
    expect(update.providerRef).toBe('del_123');
    expect(update.delivery.status).toBe('collected');
    expect(update.delivery.courier?.vehicleType).toBe('car');
    expect(update.liveMode).toBe(false);
  });
});
