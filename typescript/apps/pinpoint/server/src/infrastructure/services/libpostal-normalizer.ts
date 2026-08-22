/**
 * libpostal-backed `AddressNormalizer`. Talks HTTP to the
 * `pelias/libpostal-service` sidecar — same image and same wire shape
 * the Rust pinpoint targets, so a TS write hashes identically to a
 * Rust write for the same input.
 *
 * Endpoints (per pelias/libpostal-service):
 *   GET /parse?address=...    → [ { label, value }, ... ]
 *   GET /expand?address=...   → [ "expanded form 1", "...", ... ]
 *
 * Mirror of Rust `LibPostalNormalizer`. Extraction order matches Rust
 * verbatim — including the libpostal-can't-find-country fallback that
 * pulls the last comma-separated segment of the input.
 */
import type {
  AddressNormalizer,
  NormalizeOptions,
  NormalizedAddress,
} from '../../domain/services/address-normalizer.js';
import { applySubstitutions } from '../../domain/services/address-matcher.js';

interface ParseComponent {
  readonly label: string;
  readonly value: string;
}

/**
 * Stand-in stored for a city/country that libpostal couldn't identify when
 * running best-effort (`strict: false`). The record is ingested with this
 * marker + lands PENDING, so a reviewer / the geocoder can resolve the real
 * value later. `master_locations.normalized_city` is NOT NULL, so we can't
 * store null here.
 */
const UNRESOLVED = 'UNKNOWN';

/** The `n`-th comma-separated segment counted from the end (0 = last). */
function segmentFromEnd(address: string, fromEnd: number): string | null {
  const segments = address
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const index = segments.length - 1 - fromEnd;
  return index >= 0 ? (segments[index] ?? null) : null;
}

export interface LibPostalNormalizerConfig {
  /** Base URL of the sidecar, e.g. `http://localhost:4400`. No trailing slash. */
  readonly baseUrl: string;
  /** Request timeout in ms. Default 10s matches the Rust client. */
  readonly timeoutMs?: number;
}

const CONSUMING_LABELS: ReadonlySet<string> = new Set([
  'postcode',
  'city',
  'state',
  'suburb',
  'city_district',
  'state_district',
  'road',
  'house_number',
]);

/**
 * The last comma-separated segment is a usable country only if libpostal did
 * not already assign its text to another component and it is not just a
 * number (a bare postcode). Otherwise: no country.
 */
function countryFromTrailingSegment(
  address: string,
  components: readonly ParseComponent[],
): string | null {
  const segment = segmentFromEnd(address, 0);
  if (segment === null) return null;
  const seg = segment.toLowerCase();
  if (/^[\d\s-]+$/.test(seg)) return null;
  const consumed = components
    .filter((c) => CONSUMING_LABELS.has(c.label))
    .map((c) => c.value.toLowerCase());
  // libpostal lower-cases and strips punctuation; compare on the same footing.
  const segTokens = seg
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const covered = segTokens.every((t) => consumed.some((v) => v.split(/\s+/).includes(t)));
  return covered ? null : segment;
}

/**
 * libpostal `/expand` returns every expansion of an abbreviation ("long st" →
 * ["long saint", "long street"]). Prefer the one that agrees with the
 * matcher's own substitution table (the authority for ZA street types and
 * Afrikaans → English), then the canonical form itself, then the first.
 */
const STREET_TYPES: ReadonlySet<string> = new Set([
  'street',
  'road',
  'avenue',
  'drive',
  'lane',
  'boulevard',
  'court',
  'place',
  'crescent',
  'way',
  'close',
  'square',
  'terrace',
  'highway',
  'circle',
  'parade',
  'grove',
  'rise',
  // Afrikaans forms the matcher maps to English at compare time
  'straat',
  'weg',
  'laan',
  'rylaan',
  'singel',
  'rif',
]);
const lastToken = (s: string): string => s.toLowerCase().trim().split(/\s+/).at(-1) ?? '';

export function pickRoadExpansion(road: string, expansions: readonly string[]): string {
  const canonical = applySubstitutions(road.toLowerCase());
  const exact = expansions.find((e) => e.toLowerCase() === canonical);
  if (exact !== undefined) return exact;
  // "long st" → ["long saint", "long street"]: a road name ends in a street type.
  const typed = expansions.find((e) => STREET_TYPES.has(lastToken(e)));
  if (typed !== undefined) return typed;
  if (canonical !== road.toLowerCase()) return canonical;
  return expansions[0] ?? road;
}

function extract(components: readonly ParseComponent[], label: string): string | null {
  const hit = components.find((c) => c.label === label);
  return hit ? hit.value : null;
}

export function createLibPostalNormalizer(config: LibPostalNormalizerConfig): AddressNormalizer {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const timeoutMs = config.timeoutMs ?? 10_000;

  async function callJson<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`libpostal ${path} returned ${response.status}: ${body.slice(0, 200)}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async normalize(address: string, options?: NormalizeOptions): Promise<NormalizedAddress> {
      const strict = options?.strict ?? true;
      const components = await callJson<readonly ParseComponent[]>('/parse', { address });

      const houseNumber = extract(components, 'house_number');
      const road = extract(components, 'road');
      const suburb = extract(components, 'suburb') ?? extract(components, 'city_district');

      const state = extract(components, 'state');
      const postalCode = extract(components, 'postcode');

      // City: libpostal sometimes puts the city under `state_district` or
      // (very rarely) under `suburb` for small hamlets. Try in order
      // matching the Rust fallback chain.
      let city =
        extract(components, 'city') ??
        extract(components, 'state_district') ??
        extract(components, 'suburb');
      if (city === null) {
        if (strict) {
          throw new Error('libpostal could not identify a city in the address');
        }
        // Best-effort: fall back to the state, then the city-ish comma segment
        // (the one before the trailing country segment), then a marker.
        city = state ?? segmentFromEnd(address, 1) ?? UNRESOLVED;
      }

      // Country: try the parsed label first; fall back to the last
      // comma-separated segment of the input (works for ".../South Africa"
      // style addresses where libpostal sometimes misclassifies the country).
      // Country fallback: the trailing comma segment — but only when libpostal
      // did not already file that text under another component. "…, Cape
      // Town, 8001" ends in the postcode, "…, Cape Town 8001" in city+postcode;
      // neither is a country, and treating it as one poisons the hash and the
      // match score. Leaving it null lets the caller retry with its country
      // code (create-location appends `, <countryCode>` on strict failure).
      let country =
        extract(components, 'country') ?? countryFromTrailingSegment(address, components);
      if (country === null) {
        if (strict) {
          throw new Error('libpostal could not identify a country in the address');
        }
        country = UNRESOLVED;
      }

      // Expand the road for better normalization (St → Street, etc.).
      // /expand returns multiple variants — we take the first one
      // matching the Rust pattern. Falls back to the parsed road if
      // /expand fails for any reason.
      let expandedRoad: string | null = road;
      if (road !== null) {
        try {
          const expansions = await callJson<readonly string[]>('/expand', { address: road });
          expandedRoad = pickRoadExpansion(road, expansions);
        } catch {
          // Fall through with the parsed road as-is.
        }
      }

      return {
        houseNumber,
        road: expandedRoad,
        suburb,
        city,
        state,
        postalCode,
        country,
      };
    },
  };
}
