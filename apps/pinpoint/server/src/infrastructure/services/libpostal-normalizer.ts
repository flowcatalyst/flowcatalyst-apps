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
  NormalizedAddress,
} from '../../domain/services/address-normalizer.js';

interface ParseComponent {
  readonly label: string;
  readonly value: string;
}

export interface LibPostalNormalizerConfig {
  /** Base URL of the sidecar, e.g. `http://localhost:4400`. No trailing slash. */
  readonly baseUrl: string;
  /** Request timeout in ms. Default 10s matches the Rust client. */
  readonly timeoutMs?: number;
}

export function createLibPostalNormalizer(
  config: LibPostalNormalizerConfig,
): AddressNormalizer {
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
        throw new Error(
          `libpostal ${path} returned ${response.status}: ${body.slice(0, 200)}`,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  function extract(components: readonly ParseComponent[], label: string): string | null {
    const hit = components.find((c) => c.label === label);
    return hit ? hit.value : null;
  }

  return {
    async normalize(address: string): Promise<NormalizedAddress> {
      const components = await callJson<readonly ParseComponent[]>('/parse', { address });

      const houseNumber = extract(components, 'house_number');
      const road = extract(components, 'road');
      const suburb =
        extract(components, 'suburb') ?? extract(components, 'city_district');

      // City: libpostal sometimes puts the city under `state_district` or
      // (very rarely) under `suburb` for small hamlets. Try in order
      // matching the Rust fallback chain.
      const city =
        extract(components, 'city') ??
        extract(components, 'state_district') ??
        extract(components, 'suburb');
      if (city === null) {
        throw new Error('libpostal could not identify a city in the address');
      }

      const state = extract(components, 'state');
      const postalCode = extract(components, 'postcode');

      // Country: try the parsed label first; fall back to the last
      // comma-separated segment of the input (works for ".../South Africa"
      // style addresses where libpostal sometimes misclassifies the country).
      let country = extract(components, 'country');
      if (country === null) {
        const segments = address.split(',');
        const last = segments[segments.length - 1]?.trim();
        country = last && last.length > 0 ? last : null;
      }
      if (country === null) {
        throw new Error('libpostal could not identify a country in the address');
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
