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
 * postcode → 1.0). Mirrors Rust `compute_confidence`, except that a result
 * on the wrong road earns no street / housenumber credit.
 *
 * Forward geocoding does not trust Photon's top hit. Photon ranks free text,
 * and a suburb or postcode that disagrees with OSM (the caller says
 * "Blairgowrie, 2194", OSM files the road under "Robin Acres, 2024") outranks
 * the road name — the top hit lands on a different street entirely. So each
 * search asks for several candidates and keeps the first on the requested
 * road; when none is, it retries with the conflicting components dropped —
 * suburb + postcode, then house number, and finally the city (accepted only
 * near the best guess so far). Only if every attempt misses does it fall back to the first candidate,
 * reported as `roadMatched: false`.
 *
 * Uses Node's global fetch (24 LTS). No `reqwest` equivalent dependency.
 */
import { isUnresolved, type NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type { CountryNameResolver } from './country-name-resolver.js';
import { roadCore, roadInLine, sameRoad } from './road-names.js';
import type {
  GeocodeTextOptions,
  GeocoderService,
  GeocodingResult,
  ReverseGeocodingResult,
} from '../../domain/services/geocoder.js';

/** Candidates requested per search — enough to find the road below a wrong top hit. */
const CANDIDATE_LIMIT = 5;
/** Upper bound on upstream searches per forward geocode, retries included. */
const MAX_ATTEMPTS = 5;
/**
 * How far the city-less last resort may land from the earlier best guess.
 * Covers OSM placing a road in a neighbouring "city" (Curvy Road: caller says
 * Randburg, OSM says Rosebank, ~4 km apart) without accepting a same-named
 * road in another town.
 */
const CITYLESS_RADIUS_KM = 15;

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
    /** Photon result granularity: `house`, `street`, `city`, … */
    type?: string;
    osm_key?: string;
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
  /**
   * Optional ISO-code → country-name resolver. Self-hosted Photon indexes match
   * country names but not ISO codes, so `…, zaf` finds nothing where
   * `…, south africa` matches. When supplied, a 2/3-letter country token is
   * widened to its name for the query only — stored components are untouched,
   * because they feed `addressHash`. Returns null to leave the token as-is.
   */
  readonly resolveCountryName?: CountryNameResolver;
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

  async function search(query: string, near?: LatLon): Promise<PhotonFeature[]> {
    const url = new URL(`${baseUrl}/api`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(CANDIDATE_LIMIT));
    if (near) {
      url.searchParams.set('lat', String(near.lat));
      url.searchParams.set('lon', String(near.lon));
    }

    const response = await photonFetch(url);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Photon search returned ${response.status}: ${body.slice(0, 200)}`);
    }
    return ((await response.json()) as PhotonResponse).features;
  }

  /**
   * Run `queries` in order and return the first candidate `onRoad` accepts.
   * With no `onRoad` (the request named no road) the first query's top hit
   * wins. If nothing is accepted, fall back to the top hit of the first query
   * that returned anything, flagged `roadMatched: false`.
   */
  async function searchLadder(
    queries: readonly string[],
    onRoad: ((props: PhotonFeature['properties']) => boolean) | null,
  ): Promise<GeocodingResult> {
    let fallback: { feature: PhotonFeature; query: string } | undefined;
    for (const query of queries) {
      const features = await search(query);
      if (!onRoad) {
        if (features[0]) return toGeocodingResult(features[0], query, null);
        continue;
      }
      const hit = features.find((f) => onRoad(f.properties));
      if (hit) return toGeocodingResult(hit, query, true);
      if (!fallback && features[0]) fallback = { feature: features[0], query };
    }
    if (!fallback) throw new Error('No geocoding results found');
    return toGeocodingResult(fallback.feature, fallback.query, false);
  }

  return {
    async geocode(address: NormalizedAddress): Promise<GeocodingResult> {
      const country = await resolveQueryCountry(address, config.resolveCountryName);
      const requested = address.road ?? '';
      if (roadCore(requested).length === 0) {
        return searchLadder([buildSearchQuery(address, country)], null);
      }
      // Loosen step by step: suburb + postcode are the components most likely
      // to disagree with OSM; the house number goes last because OSM often
      // has the street but not the number.
      const loose = { ...address, suburb: null, postalCode: null };
      const queries = dedupe([
        buildSearchQuery(address, country),
        buildSearchQuery(loose, country),
        buildSearchQuery({ ...loose, houseNumber: null }, country),
      ]);
      const onRoad = (props: PhotonFeature['properties']) => sameRoad(requested, roadOf(props));
      const best = await searchLadder(queries, onRoad);
      if (best.roadMatched) return best;

      // Last resort: drop the city too. OSM's city for a road can disagree
      // with the caller's (Curvy Road is "Rosebank" in OSM, "Randburg" to the
      // caller), and without a road-type word the city outranks the road name.
      // Without a city a same-named road anywhere in the province would match,
      // so bias towards the best guess so far and only accept a hit near it.
      if (!address.state && !country) return best;
      const regional = [address.road, address.state, country].filter(Boolean).join(', ');
      if (isUnresolved(address.city) || queries.includes(regional)) return best;
      const anchor = { lat: best.latitude, lon: best.longitude };
      const hit = (await search(regional, anchor)).find(
        (f) => onRoad(f.properties) && distanceKm(anchor, f) <= CITYLESS_RADIUS_KM,
      );
      return hit ? toGeocodingResult(hit, regional, true) : best;
    },

    async geocodeText(line: string, options?: GeocodeTextOptions): Promise<GeocodingResult> {
      let base = line.trim();
      const code = options?.countryCode?.trim();
      if (code && config.resolveCountryName) {
        const name = await config.resolveCountryName(code);
        if (name && !base.toLowerCase().includes(name.toLowerCase())) base = `${base}, ${name}`;
      }
      return searchLadder(textQueryLadder(base), (props) => roadInLine(roadOf(props), base));
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
      return {
        address: toNormalizedAddress(props),
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
 * The country token for the query, or null when the country is unresolved.
 * Widens an ISO code to the country name — self-hosted Photon indexes match
 * names, not codes.
 */
async function resolveQueryCountry(
  addr: NormalizedAddress,
  resolveCountryName?: CountryNameResolver,
): Promise<string | null> {
  if (isUnresolved(addr.country)) return null;
  return resolveCountryName
    ? ((await resolveCountryName(addr.country)) ?? addr.country)
    : addr.country;
}

/**
 * Build the Photon `q` parameter from a normalized address. Order
 * matches the Rust client so identical addresses produce identical
 * upstream requests across both backends.
 */
function buildSearchQuery(addr: NormalizedAddress, country: string | null): string {
  const parts: string[] = [];
  if (addr.houseNumber) parts.push(addr.houseNumber);
  if (addr.road) parts.push(addr.road);
  if (addr.suburb) parts.push(addr.suburb);
  // `city` and `country` are the two NOT NULL components, so an unparsed value
  // arrives as the UNKNOWN marker rather than null. Sending it upstream asks
  // Photon to find a place called UNKNOWN, which costs relevance — omit it and
  // let the remaining components carry the search.
  if (!isUnresolved(addr.city)) parts.push(addr.city);
  if (addr.state) parts.push(addr.state);
  if (addr.postalCode) parts.push(addr.postalCode);
  if (country) parts.push(country);
  return parts.join(', ');
}

/**
 * Successively looser variants of a free-text line, most specific first:
 * the line as given; postcodes removed; then each middle segment dropped in
 * turn (the first segment usually carries the street and the last the
 * country, so both stay). Mirrors the structured ladder without a parse —
 * the suburb is whichever middle segment OSM disagrees with.
 */
function textQueryLadder(line: string): string[] {
  const segments = line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const queries = [segments.join(', ')];

  const stripped = segments
    .map((s, i) => (i === 0 ? s : s.replace(/\s+\d{4,6}$/, '')))
    .filter((s) => !/^\d{3,6}$/.test(s));
  queries.push(stripped.join(', '));

  if (stripped.length >= 4) {
    for (let i = 1; i < stripped.length - 1; i++) {
      queries.push(stripped.filter((_, j) => j !== i).join(', '));
    }
  }
  return dedupe(queries).slice(0, MAX_ATTEMPTS);
}

interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** Great-circle distance from `a` to a feature, in km (haversine). */
function distanceKm(a: LatLon, feature: PhotonFeature): number {
  const [lon, lat] = feature.geometry.coordinates;
  const rad = Math.PI / 180;
  const dLat = (lat - a.lat) * rad;
  const dLon = (lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** A street-granularity result carries the road in `name`, not `street`. */
function isStreetFeature(props: PhotonFeature['properties']): boolean {
  return props.type === 'street' || props.osm_key === 'highway';
}

function roadOf(props: PhotonFeature['properties']): string | null {
  return props.street ?? (isStreetFeature(props) ? props.name : undefined) ?? null;
}

/** `name` is a settlement only for non-street results; on a street it is the road. */
function cityOf(props: PhotonFeature['properties']): string | undefined {
  return props.city ?? (isStreetFeature(props) ? undefined : props.name);
}

function toGeocodingResult(
  feature: PhotonFeature,
  query: string,
  roadMatched: boolean | null,
): GeocodingResult {
  const [lon, lat] = feature.geometry.coordinates;
  return {
    latitude: lat,
    longitude: lon,
    confidence: computeConfidence(feature.properties, roadMatched),
    formattedAddress: formatAddress(feature.properties),
    address: toNormalizedAddress(feature.properties),
    roadMatched,
    query,
    source: 'PHOTON',
  };
}

/**
 * Map Photon feature properties onto the canonical `NormalizedAddress`
 * shape. Photon labels a bare settlement result under `name` rather than
 * `city`, so `name` is the city fallback; `country` carries the ISO code
 * (`countrycode`) rather than the display name, matching what the
 * normalizer produces for the same address.
 */
function toNormalizedAddress(props: PhotonFeature['properties']): NormalizedAddress {
  return {
    houseNumber: props.housenumber ?? null,
    road: roadOf(props),
    suburb: props.district ?? null,
    city: cityOf(props) ?? '',
    state: props.state ?? null,
    postalCode: props.postcode ?? null,
    country: props.countrycode ?? '',
  };
}

function formatAddress(props: PhotonFeature['properties']): string {
  const parts: string[] = [];
  const road = roadOf(props);
  const city = cityOf(props);
  if (props.housenumber && road) {
    parts.push(`${props.housenumber} ${road}`);
  } else if (props.housenumber) {
    parts.push(props.housenumber);
  } else if (road) {
    parts.push(road);
  }
  if (props.district) parts.push(props.district);
  if (city) parts.push(city);
  if (props.state) parts.push(props.state);
  if (props.postcode) parts.push(props.postcode);
  if (props.country) parts.push(props.country);
  return parts.join(', ');
}

/**
 * Component-completeness confidence score, 0..1. Photon doesn't return
 * a confidence value, so we synthesize one from which fields landed
 * in the result. Weights mirror Rust `compute_confidence`. A result on the
 * wrong road (`roadMatched === false`) gets no street or housenumber credit —
 * a house number on some other street is not evidence of a match.
 */
function computeConfidence(
  props: PhotonFeature['properties'],
  roadMatched: boolean | null = null,
): number {
  let score = 0;
  const onRoad = roadMatched !== false;
  if (props.housenumber && onRoad) score += 0.2;
  if (roadOf(props) && onRoad) score += 0.25;
  if (cityOf(props)) score += 0.25;
  if (props.countrycode || props.country) score += 0.2;
  if (props.postcode) score += 0.1;
  return score;
}
