/**
 * Rate-limited decorator around any `GeocoderService`. Token-bucket
 * throttling implemented in plain TS — sustained `requestsPerSecond` rate
 * with burst capacity equal to `requestsPerSecond` (i.e. the bucket starts
 * full and refills at a steady drip).
 *
 * Buckets are keyed by `config.key` at module scope, so multiple decorators
 * constructed against the same upstream API can share a bucket and stay
 * within the upstream quota in aggregate. Distinct keys get independent
 * buckets. Same key with a mismatched `requestsPerSecond` throws — that's
 * always a configuration bug (two writers with different opinions about
 * the upstream's quota), and silently picking one would mask it.
 *
 * The decorator exposes Promises so call sites stay plain async/await —
 * consistent with the rest of the post-Effect pinpoint server.
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
   * Limiter key — decorators sharing this key share a token bucket so the
   * aggregate request rate stays under `requestsPerSecond`. Default
   * `pinpoint:geocoding`.
   */
  readonly key?: string;
}

interface Bucket {
  readonly capacity: number;
  readonly refillIntervalMs: number;
  tokens: number;
  lastRefillAt: number;
  /**
   * Pending-acquire queue: each call that can't take a token waits its
   * turn here so concurrent callers see correct burst-then-throttle order.
   */
  waitChain: Promise<void>;
}

const buckets = new Map<string, Bucket>();

/**
 * Test-only: drop all in-process buckets so a unit test starts clean.
 * Production code never calls this.
 */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

function getOrCreateBucket(key: string, requestsPerSecond: number): Bucket {
  const capacity = Math.max(1, requestsPerSecond);
  const existing = buckets.get(key);
  if (existing) {
    if (existing.capacity !== capacity) {
      throw new Error(
        `Rate-limit key '${key}' already registered with capacity ${existing.capacity}; ` +
          `cannot re-register with capacity ${capacity}. Use distinct keys for distinct quotas.`,
      );
    }
    return existing;
  }
  const bucket: Bucket = {
    capacity,
    refillIntervalMs: 1000 / capacity,
    tokens: capacity,
    lastRefillAt: Date.now(),
    waitChain: Promise.resolve(),
  };
  buckets.set(key, bucket);
  return bucket;
}

function refill(bucket: Bucket): void {
  const now = Date.now();
  const elapsed = now - bucket.lastRefillAt;
  if (elapsed <= 0) return;
  const newTokens = elapsed / bucket.refillIntervalMs;
  if (newTokens <= 0) return;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + newTokens);
  bucket.lastRefillAt = now;
}

function acquire(bucket: Bucket): Promise<void> {
  // Serialize via the wait chain so a burst of concurrent callers
  // doesn't all race for the same single token.
  const slot = bucket.waitChain.then(async () => {
    refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }
    const needed = 1 - bucket.tokens;
    const waitMs = Math.ceil(needed * bucket.refillIntervalMs);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    refill(bucket);
    bucket.tokens = Math.max(0, bucket.tokens - 1);
  });
  bucket.waitChain = slot.catch(() => {
    // Don't poison the chain on errors.
  });
  return slot;
}

export function createRateLimitedGeocoder(
  inner: GeocoderService,
  config: RateLimitedGeocoderConfig,
): GeocoderService {
  const key = config.key ?? 'pinpoint:geocoding';
  const bucket = getOrCreateBucket(key, config.requestsPerSecond);

  return {
    async geocode(address: NormalizedAddress): Promise<GeocodingResult> {
      await acquire(bucket);
      return inner.geocode(address);
    },
    async reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult> {
      await acquire(bucket);
      return inner.reverseGeocode(latitude, longitude);
    },
  };
}
