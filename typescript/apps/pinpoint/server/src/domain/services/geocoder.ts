/**
 * Geocoder service interface — port of Rust
 * `pinpoint-domain/src/services/geocoder.rs::Geocoder`.
 *
 * Plain async interface (not an Effect Tag) — matches the repository
 * pattern. Composed at the AppContext composition root; routes call it
 * directly via `appContext.services.geocoder`. When a use case later
 * needs to inject a test double, the constructor-injection path is
 * available — same as repositories.
 *
 * Rate-limiting is layered on as a decorator (`RateLimitedGeocoder`)
 * in `infrastructure/services/`, so consumers always get a throttled
 * instance without needing to know how the throttling is implemented.
 */
import type { NormalizedAddress } from './address-normalizer.js';

export interface GeocodingResult {
  readonly latitude: number;
  readonly longitude: number;
  /** 0..1 — Photon doesn't return confidence natively; we score component completeness. */
  readonly confidence: number;
  readonly formattedAddress: string | null;
}

export interface ReverseGeocodingResult {
  readonly address: NormalizedAddress;
  readonly formattedAddress: string;
  readonly confidence: number;
}

export interface GeocoderService {
  /**
   * Forward geocode a normalized address to coordinates. Throws on
   * upstream failure or no-result. Route handlers map thrown errors to
   * HTTP 502/500 — see `api/routes/geocode/*`.
   */
  geocode(address: NormalizedAddress): Promise<GeocodingResult>;

  /**
   * Reverse geocode coordinates to an address. Throws on upstream
   * failure or no-result.
   */
  reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult>;
}
