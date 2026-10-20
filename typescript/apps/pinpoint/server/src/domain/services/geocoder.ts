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

/** Which upstream produced a geocode. */
export const GEOCODE_SOURCES = ['PHOTON', 'GOOGLE_MAPS'] as const;
export type GeocodeSource = (typeof GEOCODE_SOURCES)[number];

export interface GeocodingResult {
  readonly latitude: number;
  readonly longitude: number;
  /** 0..1 — Photon doesn't return confidence natively; we score component completeness. */
  readonly confidence: number;
  readonly formattedAddress: string | null;
  /**
   * Structured components of the address the geocoder actually matched.
   * May differ from the query address (the geocoder resolves to the nearest
   * known feature), which is exactly why callers want it — it explains what
   * the returned coordinate refers to.
   */
  readonly address: NormalizedAddress;
  /**
   * Whether the matched feature sits on the road the caller asked for. `null`
   * when the request named no road (structured input with `road` unset).
   * `false` means the geocoder found nothing on that road and fell back to
   * its best guess — treat the coordinate as approximate at best.
   */
  readonly roadMatched: boolean | null;
  /** The exact query string sent upstream for the returned result. */
  readonly query: string;
  /** Which upstream produced this result. */
  readonly source: GeocodeSource;
}

export interface GeocodeTextOptions {
  /**
   * ISO country code hint. Widened to the country name and appended to the
   * line when the line doesn't already mention it.
   */
  readonly countryCode?: string | null;
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
   * Forward geocode a free-text address line as-is — no libpostal parse.
   * Throws on upstream failure or no-result.
   */
  geocodeText(line: string, options?: GeocodeTextOptions): Promise<GeocodingResult>;

  /**
   * Reverse geocode coordinates to an address. Throws on upstream
   * failure or no-result.
   */
  reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult>;
}
