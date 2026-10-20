/**
 * Primary → fallback geocoder: Photon (OSM) first, Google Maps only when
 * Photon falls short. "Short" means the result is not on the requested road,
 * or the caller gave a house number and the result has none (OSM often maps
 * the street but not the number — 16 Curvy Road, Blairgowrie).
 *
 * The fallback is used only when it does better: a fallback result that is
 * also short loses to the primary's. A fallback failure is reported and the
 * primary's result (or error) stands, so Google being down or over quota
 * never makes geocoding worse than Photon alone.
 *
 * Reverse geocoding uses the primary only.
 */
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type {
  GeocodeTextOptions,
  GeocoderService,
  GeocodingResult,
  ReverseGeocodingResult,
} from '../../domain/services/geocoder.js';

export interface FallbackGeocoderOptions {
  /** Called when the fallback is consulted, with why. */
  readonly onFallback?: (reason: string) => void;
  /** Called when the fallback itself fails. */
  readonly onError?: (err: unknown) => void;
}

/** A leading number token: `16`, `16a`, `16-18`. */
const HOUSE_NUMBER = /^\d+[a-z]?\b/i;

/** Structured input wants a house: a house number, or a road like "16 Curvy". */
export function wantsHouse(address: NormalizedAddress): boolean {
  if (address.houseNumber?.trim()) return true;
  return HOUSE_NUMBER.test(address.road?.trim() ?? '');
}

/** Free text wants a house when its first segment starts with a number. */
export function lineWantsHouse(line: string): boolean {
  const first = line.split(',')[0]?.trim() ?? '';
  return HOUSE_NUMBER.test(first);
}

export function createFallbackGeocoder(
  primary: GeocoderService,
  fallback: GeocoderService,
  options: FallbackGeocoderOptions = {},
): GeocoderService {
  async function withFallback(
    house: boolean,
    first: () => Promise<GeocodingResult>,
    second: () => Promise<GeocodingResult>,
  ): Promise<GeocodingResult> {
    const good = (r: GeocodingResult) =>
      r.roadMatched !== false && (!house || Boolean(r.address.houseNumber?.trim()));

    let primaryResult: GeocodingResult | null = null;
    let primaryError: unknown = null;
    try {
      primaryResult = await first();
      if (good(primaryResult)) return primaryResult;
    } catch (err) {
      primaryError = err;
    }

    options.onFallback?.(reasonFor(primaryResult, primaryError, house));
    try {
      const result = await second();
      if (good(result) || !primaryResult) return result;
      return primaryResult;
    } catch (err) {
      options.onError?.(err);
      if (primaryResult) return primaryResult;
      throw isNoResults(primaryError) || !isNoResults(err) ? primaryError : err;
    }
  }

  return {
    geocode(address: NormalizedAddress): Promise<GeocodingResult> {
      return withFallback(
        wantsHouse(address),
        () => primary.geocode(address),
        () => fallback.geocode(address),
      );
    },

    geocodeText(line: string, opts?: GeocodeTextOptions): Promise<GeocodingResult> {
      return withFallback(
        lineWantsHouse(line),
        () => primary.geocodeText(line, opts),
        () => fallback.geocodeText(line, opts),
      );
    },

    reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult> {
      return primary.reverseGeocode(latitude, longitude);
    },
  };
}

function reasonFor(result: GeocodingResult | null, error: unknown, house: boolean): string {
  if (!result) return `primary failed: ${error instanceof Error ? error.message : String(error)}`;
  if (result.roadMatched === false) return 'primary result not on the requested road';
  return house ? 'primary result has no house number' : 'primary result rejected';
}

function isNoResults(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('No geocoding results');
}
