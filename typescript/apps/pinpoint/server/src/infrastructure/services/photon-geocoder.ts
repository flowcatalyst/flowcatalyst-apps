/**
 * Photon-backed implementation of `GeocoderService`. Photon is the
 * OSM/Komoot search service that the Rust pinpoint already uses
 * (see `~/Developer/tangent/pinpoint/pinpoint-infra/src/services/
 * geocoding_client.rs`). Public hosted instance lives at
 * https://photon.komoot.io; self-hosted instances live at any URL
 * — configurable via `PINPOINT_GEOCODING_API_URL`.
 *
 * Photon does not return a confidence score, so we compute one from
 * component completeness (housenumber + street + city + country +
 * postcode → 1.0). Mirrors Rust `compute_confidence`.
 *
 * Uses Node's global fetch (24 LTS). No `reqwest` equivalent dependency.
 */
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type {
  GeocoderService,
  GeocodingResult,
  ReverseGeocodingResult,
} from '../../domain/services/geocoder.js';

interface PhotonFeature {
  geometry: { coordinates: [number, number] }; // [lon, lat]
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
  };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

export interface PhotonGeocoderConfig {
  /** Base URL, e.g. `https://photon.komoot.io`. No trailing slash. */
  readonly baseUrl: string;
  /** Optional User-Agent override. Public Photon instance requires one. */
  readonly userAgent?: string;
}

export function createPhotonGeocoder(config: PhotonGeocoderConfig): GeocoderService {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const userAgent = config.userAgent ?? 'pinpoint-geocoder/0.1';

  // Node's global fetch throws a bare `TypeError: fetch failed` on any network
  // failure; the actionable detail (ENOTFOUND / ECONNREFUSED / timeout) is
  // buried in the `.cause` chain (and AggregateError.errors for happy-eyeballs).
  // Wrap it so the thrown message names the target host + the underlying code —
  // otherwise a Photon outage surfaces to the caller as an opaque "fetch failed".
  async function photonFetch(url: URL): Promise<Response> {
    try {
      return await fetch(url, { headers: { 'user-agent': userAgent } });
    } catch (cause) {
      const code = networkErrorCode(cause);
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Photon request to ${url.origin} failed${code ? ` (${code})` : ''}: ${detail}`,
        { cause },
      );
    }
  }

  return {
    async geocode(address: NormalizedAddress): Promise<GeocodingResult> {
      const query = buildSearchQuery(address);
      const url = new URL(`${baseUrl}/api`);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '1');

      const response = await photonFetch(url);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Photon search returned ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = (await response.json()) as PhotonResponse;
      const feature = data.features[0];
      if (!feature) throw new Error('No geocoding results found');

      const [lon, lat] = feature.geometry.coordinates;
      return {
        latitude: lat,
        longitude: lon,
        confidence: computeConfidence(feature.properties),
        formattedAddress: formatAddress(feature.properties),
      };
    },

    async reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult> {
      const url = new URL(`${baseUrl}/reverse`);
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      url.searchParams.set('limit', '1');

      const response = await photonFetch(url);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Photon reverse returned ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = (await response.json()) as PhotonResponse;
      const feature = data.features[0];
      if (!feature) throw new Error('No reverse geocoding results found');

      const props = feature.properties;
      const city = props.city ?? props.name ?? '';
      const address: NormalizedAddress = {
        houseNumber: props.housenumber ?? null,
        road: props.street ?? null,
        suburb: props.district ?? null,
        city,
        state: props.state ?? null,
        postalCode: props.postcode ?? null,
        country: props.countrycode ?? '',
      };
      return {
        address,
        formattedAddress: formatAddress(props),
        confidence: computeConfidence(props),
      };
    },
  };
}

/**
 * Dig the OS-level error code (ENOTFOUND, ECONNREFUSED, ETIMEDOUT,
 * UND_ERR_CONNECT_TIMEOUT, …) out of a failed-fetch error. Node wraps the real
 * cause under `.cause`, and happy-eyeballs surfaces multiple attempts as an
 * `AggregateError` whose `.errors[]` hold the codes. Returns the first found.
 */
function networkErrorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const errors = (cur as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      cur = errors[0];
      continue;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Build the Photon `q` parameter from a normalized address. Order
 * matches the Rust client so identical addresses produce identical
 * upstream requests across both backends.
 */
function buildSearchQuery(addr: NormalizedAddress): string {
  const parts: string[] = [];
  if (addr.houseNumber) parts.push(addr.houseNumber);
  if (addr.road) parts.push(addr.road);
  if (addr.suburb) parts.push(addr.suburb);
  parts.push(addr.city);
  if (addr.state) parts.push(addr.state);
  if (addr.postalCode) parts.push(addr.postalCode);
  parts.push(addr.country);
  return parts.join(', ');
}

function formatAddress(props: PhotonFeature['properties']): string {
  const parts: string[] = [];
  if (props.housenumber && props.street) {
    parts.push(`${props.housenumber} ${props.street}`);
  } else if (props.housenumber) {
    parts.push(props.housenumber);
  } else if (props.street) {
    parts.push(props.street);
  }
  if (props.district) parts.push(props.district);
  if (props.city) parts.push(props.city);
  else if (props.name) parts.push(props.name);
  if (props.state) parts.push(props.state);
  if (props.postcode) parts.push(props.postcode);
  if (props.country) parts.push(props.country);
  return parts.join(', ');
}

/**
 * Component-completeness confidence score, 0..1. Photon doesn't return
 * a confidence value, so we synthesize one from which fields landed
 * in the result. Weights mirror Rust `compute_confidence`.
 */
function computeConfidence(props: PhotonFeature['properties']): number {
  let score = 0;
  if (props.housenumber) score += 0.2;
  if (props.street) score += 0.25;
  if (props.city || props.name) score += 0.25;
  if (props.countrycode || props.country) score += 0.2;
  if (props.postcode) score += 0.1;
  return score;
}
