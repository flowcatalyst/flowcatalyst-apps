/**
 * Google Maps Geocoding API implementation of `GeocoderService` — the fallback
 * for addresses OSM (Photon) only knows to street level. Google has far better
 * house-number coverage in South Africa; it costs per request, so pinpoint
 * asks it only when Photon falls short (`fallback-geocoder.ts`).
 *
 * Results are mapped onto the same shape Photon produces: `country` is the ISO
 * code (`short_name`), the road is `route`, the suburb the first sublocality.
 * Google returns a precision (`location_type`), which becomes the confidence —
 * unlike Photon, where confidence is synthesised from component completeness.
 *
 * The API key travels in the query string, so request URLs are never put into
 * error messages or logs.
 *
 * Uses Node's global fetch (24 LTS).
 */
import { isUnresolved, type NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type {
  GeocodeTextOptions,
  GeocoderService,
  GeocodingResult,
  ReverseGeocodingResult,
} from '../../domain/services/geocoder.js';
import type { CountryNameResolver } from './country-name-resolver.js';
import { roadInLine, sameRoad } from './road-names.js';

const DEFAULT_BASE_URL = 'https://maps.googleapis.com';
const DEFAULT_TIMEOUT_MS = 10_000;

/** Precision → confidence. ROOFTOP is a surveyed point; APPROXIMATE an area. */
const LOCATION_TYPE_CONFIDENCE: Readonly<Record<string, number>> = {
  ROOFTOP: 0.95,
  RANGE_INTERPOLATED: 0.85,
  GEOMETRIC_CENTER: 0.7,
  APPROXIMATE: 0.5,
};

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleResult {
  formatted_address?: string;
  address_components: GoogleAddressComponent[];
  geometry: { location: { lat: number; lng: number }; location_type?: string };
  partial_match?: boolean;
}

interface GoogleResponse {
  status: string;
  results: GoogleResult[];
  error_message?: string;
}

export interface GoogleGeocoderConfig {
  readonly apiKey: string;
  /** Default `https://maps.googleapis.com`. No trailing slash. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /**
   * Widens a 3-letter (or other non-ISO-2) country token to its name for the
   * query. Google's `components=country:` filter only takes ISO-2 codes.
   */
  readonly countryNames?: CountryNameResolver;
}

export function createGoogleGeocoder(config: GoogleGeocoderConfig): GeocoderService {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** One Geocoding API call. Throws on any non-OK status; never leaks the key. */
  async function call(params: Record<string, string>): Promise<GoogleResult> {
    const url = new URL(`${baseUrl}/maps/api/geocode/json`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('key', config.apiKey);

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Google geocoding request failed: ${detail}`, { cause });
    }
    if (!response.ok) {
      throw new Error(`Google geocoding returned HTTP ${response.status}`);
    }
    const data = (await response.json()) as GoogleResponse;
    if (data.status === 'ZERO_RESULTS') throw new Error('No geocoding results found');
    if (data.status !== 'OK') {
      throw new Error(
        `Google geocoding failed: ${data.status}${data.error_message ? `: ${data.error_message}` : ''}`,
      );
    }
    const result = data.results[0];
    if (!result) throw new Error('No geocoding results found');
    return result;
  }

  return {
    async geocode(address: NormalizedAddress): Promise<GeocodingResult> {
      const segments = [
        [address.houseNumber, address.road].filter(Boolean).join(' '),
        address.suburb,
        isUnresolved(address.city) ? null : address.city,
        address.state,
        address.postalCode,
      ];
      const params: Record<string, string> = {};
      const country = isUnresolved(address.country) ? null : address.country.trim();
      if (country && /^[a-z]{2}$/i.test(country)) {
        params['components'] = `country:${country.toUpperCase()}`;
      } else if (country) {
        segments.push((await config.countryNames?.(country)) ?? country);
      }
      const query = segments.filter((s): s is string => Boolean(s && s.trim())).join(', ');
      params['address'] = query;

      const result = await call(params);
      const matched = toNormalizedAddress(result);
      const roadMatched = address.road ? sameRoad(address.road, matched.road) : null;
      return toGeocodingResult(result, matched, query, roadMatched);
    },

    async geocodeText(line: string, options?: GeocodeTextOptions): Promise<GeocodingResult> {
      const query = line.trim();
      const params: Record<string, string> = { address: query };
      const code = options?.countryCode?.trim();
      if (code && /^[a-z]{2}$/i.test(code)) params['components'] = `country:${code.toUpperCase()}`;

      const result = await call(params);
      const address = toNormalizedAddress(result);
      const roadMatched = address.road ? roadInLine(address.road, query) : null;
      return toGeocodingResult(result, address, query, roadMatched);
    },

    async reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult> {
      const result = await call({ latlng: `${latitude},${longitude}` });
      const address = toNormalizedAddress(result);
      return {
        address,
        formattedAddress: result.formatted_address ?? '',
        confidence: confidenceOf(result, null),
      };
    },
  };
}

function toGeocodingResult(
  result: GoogleResult,
  address: NormalizedAddress,
  query: string,
  roadMatched: boolean | null,
): GeocodingResult {
  return {
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
    confidence: confidenceOf(result, roadMatched),
    formattedAddress: result.formatted_address ?? null,
    address,
    roadMatched,
    query,
    source: 'GOOGLE_MAPS',
  };
}

function confidenceOf(result: GoogleResult, roadMatched: boolean | null): number {
  let score = LOCATION_TYPE_CONFIDENCE[result.geometry.location_type ?? ''] ?? 0.5;
  if (result.partial_match) score -= 0.1;
  if (roadMatched === false) score = Math.min(score, 0.5);
  return Math.round(score * 100) / 100;
}

function component(
  result: GoogleResult,
  types: readonly string[],
  form: 'long_name' | 'short_name' = 'long_name',
): string | null {
  for (const type of types) {
    const hit = result.address_components.find((c) => c.types.includes(type));
    if (hit) return hit[form];
  }
  return null;
}

function toNormalizedAddress(result: GoogleResult): NormalizedAddress {
  return {
    houseNumber: component(result, ['street_number']),
    road: component(result, ['route']),
    suburb: component(result, ['sublocality_level_1', 'sublocality', 'neighborhood']),
    city: component(result, ['locality', 'postal_town', 'administrative_area_level_2']) ?? '',
    state: component(result, ['administrative_area_level_1']),
    postalCode: component(result, ['postal_code']),
    country: component(result, ['country'], 'short_name') ?? '',
  };
}
