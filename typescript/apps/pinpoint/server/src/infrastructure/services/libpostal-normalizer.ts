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
      let country = extract(components, 'country') ?? segmentFromEnd(address, 0);
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
          if (expansions.length > 0 && expansions[0]) {
            expandedRoad = expansions[0];
          }
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
