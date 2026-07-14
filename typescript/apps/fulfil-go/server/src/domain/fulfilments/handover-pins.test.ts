import { describe, expect, it } from 'vitest';
import type { Destination, HandoverPolicy } from '@fulfil-go/shared';
import {
  computeMaxRestrictedAge,
  generateHandoverPin,
  resolveDeliveryPin,
} from './handover-pins.js';

const policy = (over: Partial<HandoverPolicy> = {}): HandoverPolicy => ({
  pickupPinEnabled: true,
  deliveryPinEnabled: true,
  deliveryPinSource: 'random',
  ageVisualOverrideAllowed: false,
  ...over,
});

const dest = (phone?: string): Destination => ({
  kind: 'delivery',
  location: {
    address: { countryCode: 'ZA' },
    ...(phone ? { contact: { phone } } : {}),
  },
});

describe('generateHandoverPin', () => {
  it('is 4 digits, leading-zero safe', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateHandoverPin()).toMatch(/^\d{4}$/);
    }
  });
});

describe('resolveDeliveryPin', () => {
  it('null when delivery pins are off', () => {
    expect(resolveDeliveryPin(policy({ deliveryPinEnabled: false }), dest('0821234567'))).toBeNull();
  });

  it('random source ignores the phone', () => {
    const pin = resolveDeliveryPin(policy(), dest('0821234567'));
    expect(pin).toMatch(/^\d{4}$/);
  });

  it('phone-last4 uses the last 4 digits (formatting stripped)', () => {
    const pin = resolveDeliveryPin(
      policy({ deliveryPinSource: 'phone-last4' }),
      dest('+27 82 123 4567'),
    );
    expect(pin).toBe('4567');
  });

  it('phone-last4 falls back to random when no usable phone', () => {
    expect(resolveDeliveryPin(policy({ deliveryPinSource: 'phone-last4' }), dest())).toMatch(
      /^\d{4}$/,
    );
    expect(resolveDeliveryPin(policy({ deliveryPinSource: 'phone-last4' }), dest('82'))).toMatch(
      /^\d{4}$/,
    );
  });
});

describe('computeMaxRestrictedAge', () => {
  const line = (restrictedMinAge?: number) => ({
    externalLineRef: 'l1',
    sku: 'S',
    description: 'x',
    quantity: 1,
    volumetric: { weightGrams: 1000 },
    temperatureClass: 'ambient' as const,
    ...(restrictedMinAge !== undefined ? { restrictedMinAge } : {}),
  });

  it('null when nothing is restricted', () => {
    expect(computeMaxRestrictedAge([{ lines: [line(), line()] }])).toBeNull();
  });

  it('takes the HIGHEST age across all parts', () => {
    expect(
      computeMaxRestrictedAge([{ lines: [line(16), line()] }, { lines: [line(18)] }]),
    ).toBe(18);
  });
});
