/**
 * Rate-limited geocoder decorator tests. We don't try to fake Effect's
 * clock; we just measure wall-clock time across enough calls that the
 * limit is unambiguous. With limit=4/s and 8 sequential calls the
 * token-bucket forces ~1s of total delay regardless of how generous the
 * clock fudge is.
 *
 * The pass-through tests cover the interesting bits per-call (args,
 * results, error propagation) without touching the limiter at all.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type {
  GeocoderService,
  GeocodingResult,
  ReverseGeocodingResult,
} from '../../domain/services/geocoder.js';
import { createRateLimitedGeocoder, resetRateLimitBuckets } from './rate-limited-geocoder.js';

const ADDRESS: NormalizedAddress = {
  houseNumber: null,
  road: null,
  suburb: null,
  city: 'London',
  state: null,
  postalCode: null,
  country: 'GB',
};

const FAKE_RESULT: GeocodingResult = {
  latitude: 51.5,
  longitude: -0.1,
  confidence: 0.9,
  formattedAddress: 'London, GB',
};

const FAKE_REVERSE: ReverseGeocodingResult = {
  address: ADDRESS,
  formattedAddress: 'London, GB',
  confidence: 0.9,
};

function fakeInner(overrides: Partial<GeocoderService> = {}): GeocoderService {
  return {
    geocode: vi.fn().mockResolvedValue(FAKE_RESULT),
    reverseGeocode: vi.fn().mockResolvedValue(FAKE_REVERSE),
    ...overrides,
  };
}

describe('rate-limited geocoder', () => {
  describe('pass-through', () => {
    it('forwards forward-geocode args and result to the inner service', async () => {
      const inner = fakeInner();
      const geocoder = createRateLimitedGeocoder(inner, { requestsPerSecond: 100 });

      const result = await geocoder.geocode(ADDRESS);

      expect(result).toEqual(FAKE_RESULT);
      expect(inner.geocode).toHaveBeenCalledExactlyOnceWith(ADDRESS);
    });

    it('forwards reverse-geocode args and result to the inner service', async () => {
      const inner = fakeInner();
      const geocoder = createRateLimitedGeocoder(inner, { requestsPerSecond: 100 });

      const result = await geocoder.reverseGeocode(51.5, -0.1);

      expect(result).toEqual(FAKE_REVERSE);
      expect(inner.reverseGeocode).toHaveBeenCalledExactlyOnceWith(51.5, -0.1);
    });

    it('propagates errors from the inner service', async () => {
      const inner = fakeInner({
        geocode: vi.fn().mockRejectedValue(new Error('upstream boom')),
      });
      const geocoder = createRateLimitedGeocoder(inner, { requestsPerSecond: 100 });

      await expect(geocoder.geocode(ADDRESS)).rejects.toThrow('upstream boom');
    });
  });

  describe('rate limiting', () => {
    it('delays calls past the configured rate', { timeout: 5000 }, async () => {
      const inner = fakeInner();
      // 4 rps → first 4 calls burst, remaining 4 spaced out over ~1s.
      const geocoder = createRateLimitedGeocoder(inner, {
        requestsPerSecond: 4,
        // Per-test key so this test doesn't share a bucket with anything else.
        key: `pinpoint:test:rate-limit:${Math.random()}`,
      });

      const started = Date.now();
      for (let i = 0; i < 8; i++) {
        await geocoder.geocode(ADDRESS);
      }
      const elapsed = Date.now() - started;

      // Tolerance is wide: with a clean bucket the spec is ~1000ms (4 free,
      // then 4 more @ 250ms each), but the first refill timing varies and
      // we just want to assert the limiter is actually throttling.
      expect(elapsed).toBeGreaterThanOrEqual(750);
      expect(inner.geocode).toHaveBeenCalledTimes(8);
    });

    it('keys with distinct values get independent buckets', async () => {
      const inner = fakeInner();
      const keyA = `pinpoint:test:bucket-a:${Math.random()}`;
      const keyB = `pinpoint:test:bucket-b:${Math.random()}`;
      const a = createRateLimitedGeocoder(inner, { requestsPerSecond: 2, key: keyA });
      const b = createRateLimitedGeocoder(inner, { requestsPerSecond: 2, key: keyB });

      // Drain each bucket independently. If they shared a bucket the total
      // wall-clock would jump well past the 2-rps allowance for either side.
      const started = Date.now();
      await Promise.all([
        a.geocode(ADDRESS),
        a.geocode(ADDRESS),
        b.geocode(ADDRESS),
        b.geocode(ADDRESS),
      ]);
      const elapsed = Date.now() - started;

      // 4 calls across two 2-rps buckets should burn no significant time;
      // each bucket has 2 tokens to spend immediately. Keep the bound loose.
      expect(elapsed).toBeLessThan(500);
    });

    it('decorators sharing the same key share a bucket', { timeout: 5000 }, async () => {
      const inner = fakeInner();
      const key = `pinpoint:test:shared:${Math.random()}`;
      const a = createRateLimitedGeocoder(inner, { requestsPerSecond: 4, key });
      const b = createRateLimitedGeocoder(inner, { requestsPerSecond: 4, key });

      // 8 calls split across the two decorators against a single 4-rps
      // bucket should take ~1s of total throttling — same shape as 8
      // calls through a single 4-rps decorator. If the decorators had
      // independent buckets, each would drain its 4-token burst
      // instantly and the total would be < 500ms.
      const started = Date.now();
      for (let i = 0; i < 8; i++) {
        await (i % 2 === 0 ? a : b).geocode(ADDRESS);
      }
      const elapsed = Date.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(750);
      expect(inner.geocode).toHaveBeenCalledTimes(8);
    });

    it('throws when re-registering the same key with a different rate', () => {
      const inner = fakeInner();
      const key = `pinpoint:test:conflict:${Math.random()}`;
      createRateLimitedGeocoder(inner, { requestsPerSecond: 4, key });

      expect(() => createRateLimitedGeocoder(inner, { requestsPerSecond: 10, key })).toThrow(
        /capacity 4.*capacity 10/,
      );
    });

    it('resetRateLimitBuckets clears in-process state', () => {
      const inner = fakeInner();
      const key = `pinpoint:test:reset:${Math.random()}`;
      createRateLimitedGeocoder(inner, { requestsPerSecond: 4, key });

      resetRateLimitBuckets();

      // After a reset, re-registering with a different rate is fine —
      // there's no longer a bucket bound to that key.
      expect(() => createRateLimitedGeocoder(inner, { requestsPerSecond: 10, key })).not.toThrow();
    });
  });
});
