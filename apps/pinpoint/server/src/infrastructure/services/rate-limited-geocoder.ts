/**
 * Rate-limited decorator around any `GeocoderService`. Token-bucket
 * throttling implemented via Effect 4's `RateLimiter` primitive
 * (`effect/unstable/persistence` — still namespaced "unstable" in
 * 4.0.0-beta.67 but the surface is mature; see release notes if it
 * moves out of the namespace).
 *
 * Why Effect's primitive instead of porting `governor`/`bottleneck`:
 *  - Token-bucket + fixed-window built-in
 *  - `onExceeded: 'delay'` returns a `Duration` so the decorator can
 *    sleep itself rather than the limiter blocking opaquely
 *  - Same API switches to a Redis store later by swapping ONE layer
 *    (see `docs/spatial-queries.md` adjacent doc for the pattern)
 *
 * Why the decorator exposes Promises (not Effects): the
 * `GeocoderService` interface is plain async (matches the repository
 * pattern in pinpoint). Effect ceremony stays internal to this file.
 * If a use case later wants to compose geocoding with other effects,
 * it can wrap `geocoder.geocode(...)` in `Effect.tryPromise` — same
 * pattern repositories use.
 */
import { Duration, Effect, Layer, ManagedRuntime } from 'effect';
import { RateLimiter } from 'effect/unstable/persistence';
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
   * Limiter key. Multiple decorators sharing the same key share the same
   * bucket — useful if you ever wire two `GeocoderService`s against the
   * same upstream quota. Default `pinpoint:geocoding`.
   */
  readonly key?: string;
}

export function createRateLimitedGeocoder(
  inner: GeocoderService,
  config: RateLimitedGeocoderConfig,
): GeocoderService {
  const key = config.key ?? 'pinpoint:geocoding';
  // limit = requestsPerSecond, window = 1 second. Token-bucket semantics
  // give us a sustained rate with burst-of-1 — same effective shape as
  // Rust governor's `Quota::with_period`/`allow_burst(1)`.
  const limit = config.requestsPerSecond;
  const window: Duration.Duration = Duration.seconds(1);

  const limiterLayer = Layer.provide(RateLimiter.layer, RateLimiter.layerStoreMemory);
  const runtime = ManagedRuntime.make(limiterLayer);

  const acquire = Effect.gen(function* () {
    const limiter = yield* RateLimiter.RateLimiter;
    const result = yield* limiter.consume({
      algorithm: 'token-bucket',
      onExceeded: 'delay',
      window,
      limit,
      key,
    });
    if (!Duration.isZero(result.delay)) {
      yield* Effect.sleep(result.delay);
    }
  });

  return {
    async geocode(address: NormalizedAddress): Promise<GeocodingResult> {
      await runtime.runPromise(acquire);
      return inner.geocode(address);
    },
    async reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult> {
      await runtime.runPromise(acquire);
      return inner.reverseGeocode(latitude, longitude);
    },
  };
}
