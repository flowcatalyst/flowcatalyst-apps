/**
 * Rate-limited decorator around any `GeocoderService`. Token-bucket
 * throttling implemented in plain TS — sustained `requestsPerSecond` rate
 * with burst capacity equal to `requestsPerSecond` (i.e. the bucket starts
 * full and refills at a steady drip).
 *
 * The decorator exposes Promises so call sites stay plain async/await —
 * consistent with the rest of the post-Effect pinpoint server. Multiple
 * decorators sharing the same `config.key` would NOT share a bucket here;
 * the in-process bucket is per-decorator. When a process-shared bucket
 * becomes a real need we wire a Redis-backed bucket the same way the
 * earlier Effect-based wrapper described.
 */
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type {
  GeocoderService,
  GeocodingResult,
  ReverseGeocodingResult,
} from '../../domain/services/geocoder.js';

export interface RateLimitedGeocoderConfig {
  /** Sustained request rate against the upstream geocoder, requests / second. */
  readonly requestsPerSecond: number;
  /**
   * Limiter key. Reserved for future per-key bucket sharing (e.g. Redis-backed
   * store across multiple decorators). The current in-process bucket is
   * per-decorator. Default `pinpoint:geocoding`.
   */
  readonly key?: string;
}

export function createRateLimitedGeocoder(
  inner: GeocoderService,
  config: RateLimitedGeocoderConfig,
): GeocoderService {
  const capacity = Math.max(1, config.requestsPerSecond);
  const refillIntervalMs = 1000 / capacity;

  let tokens = capacity;
  let lastRefillAt = Date.now();
  // Pending-acquire queue: each call that can't take a token waits its
  // turn here so concurrent callers see correct burst-then-throttle order.
  let waitChain: Promise<void> = Promise.resolve();

  function refill(): void {
    const now = Date.now();
    const elapsed = now - lastRefillAt;
    if (elapsed <= 0) return;
    const newTokens = elapsed / refillIntervalMs;
    if (newTokens <= 0) return;
    tokens = Math.min(capacity, tokens + newTokens);
    lastRefillAt = now;
  }

  const acquire = (): Promise<void> => {
    // Serialize via the wait chain so a burst of concurrent callers
    // doesn't all race for the same single token.
    const slot = waitChain.then(async () => {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      const needed = 1 - tokens;
      const waitMs = Math.ceil(needed * refillIntervalMs);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      refill();
      tokens = Math.max(0, tokens - 1);
    });
    waitChain = slot.catch(() => {
      // Don't poison the chain on errors.
    });
    return slot;
  };

  return {
    async geocode(address: NormalizedAddress): Promise<GeocodingResult> {
      await acquire();
      return inner.geocode(address);
    },
    async reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult> {
      await acquire();
      return inner.reverseGeocode(latitude, longitude);
    },
  };
}
