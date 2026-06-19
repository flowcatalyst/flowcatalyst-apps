/**
 * Photon geocoder integration tests. Mocks `globalThis.fetch` so the tests
 * exercise the same code path that runs against live Photon — request URL
 * construction, response parsing, error mapping, confidence scoring — but
 * without burning the public photon.komoot.io rate quota in CI.
 *
 * Fixture responses are minimal-subset captures of real Photon responses
 * for a known address (548 Market St, San Francisco). Photon's full
 * response includes ~30 properties; only the fields our impl reads are
 * kept here so a future Photon schema add doesn't break the tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import { createPhotonGeocoder } from './photon-geocoder.js';

const BASE_URL = 'https://photon.example';

const FULL_ADDRESS: NormalizedAddress = {
  houseNumber: '548',
  road: 'Market Street',
  suburb: null,
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94104',
  country: 'USA',
};

const FULL_FEATURE = {
  geometry: { coordinates: [-122.4008494, 37.7899932] as [number, number] },
  properties: {
    housenumber: '548',
    street: 'Market Street',
    district: 'South of Market',
    city: 'San Francisco',
    state: 'CA',
    postcode: '94104',
    country: 'United States',
    countrycode: 'US',
  },
};

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

describe('photon-geocoder', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('forward geocode', () => {
    it('returns coordinates + confidence + formatted address on a full match', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode(FULL_ADDRESS);

      expect(result.latitude).toBe(37.7899932);
      expect(result.longitude).toBe(-122.4008494);
      expect(result.formattedAddress).toBe(
        '548 Market Street, South of Market, San Francisco, CA, 94104, United States',
      );
      // 0.20 + 0.25 + 0.25 + 0.20 + 0.10 doesn't quite land on 1.0 in IEEE-754
      // (it's 0.9999999999999999) — same arithmetic as the Rust impl, exact
      // equality intentionally avoided here.
      expect(result.confidence).toBeCloseTo(1, 10);
    });

    it('builds the `q` query string in the Rust-compatible order', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await geocoder.geocode(FULL_ADDRESS);

      const [url] = fetchSpy.mock.calls[0]!;
      const parsed = new URL(url as URL);
      expect(parsed.pathname).toBe('/api');
      expect(parsed.searchParams.get('q')).toBe(
        '548, Market Street, San Francisco, CA, 94104, USA',
      );
      expect(parsed.searchParams.get('limit')).toBe('1');
    });

    it('strips trailing slashes from the configured base URL', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: `${BASE_URL}/` });
      await geocoder.geocode(FULL_ADDRESS);

      const [url] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toMatch(`${BASE_URL}/api`);
    });

    it('sends the User-Agent header — public Photon requires one', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await geocoder.geocode(FULL_ADDRESS);

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['user-agent']).toBe('pinpoint-geocoder/0.1');
    });

    it('lets the caller override the User-Agent', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL, userAgent: 'my-app/1.2.3' });
      await geocoder.geocode(FULL_ADDRESS);

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['user-agent']).toBe('my-app/1.2.3');
    });

    it('throws "No geocoding results found" on an empty feature list', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await expect(geocoder.geocode(FULL_ADDRESS)).rejects.toThrow('No geocoding results found');
    });

    it('throws "Photon search returned <status>" on non-2xx upstream', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse('upstream broke', 502));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await expect(geocoder.geocode(FULL_ADDRESS)).rejects.toThrow(
        'Photon search returned 502: upstream broke',
      );
    });

    it('scores partial matches with the Rust-compatible weights', async () => {
      // City + countrycode only — 0.25 + 0.20 = 0.45
      const partial = {
        geometry: { coordinates: [-122, 37] as [number, number] },
        properties: { city: 'San Francisco', countrycode: 'US' },
      };
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [partial] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode(FULL_ADDRESS);

      expect(result.confidence).toBeCloseTo(0.45, 5);
    });
  });

  describe('reverse geocode', () => {
    it('returns a structured address + formatted on a full match', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.reverseGeocode(37.7899932, -122.4008494);

      expect(result.address).toEqual({
        houseNumber: '548',
        road: 'Market Street',
        suburb: 'South of Market',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94104',
        country: 'US',
      });
      expect(result.formattedAddress).toBe(
        '548 Market Street, South of Market, San Francisco, CA, 94104, United States',
      );
      expect(result.confidence).toBeCloseTo(1, 10);
    });

    it('hits /reverse with lat/lon/limit query params', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await geocoder.reverseGeocode(37.5, -122.25);

      const [url] = fetchSpy.mock.calls[0]!;
      const parsed = new URL(url as URL);
      expect(parsed.pathname).toBe('/reverse');
      expect(parsed.searchParams.get('lat')).toBe('37.5');
      expect(parsed.searchParams.get('lon')).toBe('-122.25');
      expect(parsed.searchParams.get('limit')).toBe('1');
    });

    it('falls back to `name` when city is missing', async () => {
      const feature = {
        geometry: { coordinates: [0, 0] as [number, number] },
        properties: { name: 'Some Hamlet', countrycode: 'GB' },
      };
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [feature] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.reverseGeocode(0, 0);

      expect(result.address.city).toBe('Some Hamlet');
    });

    it('prefers `countrycode` over `country` for the structured country field', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.reverseGeocode(37.5, -122.25);

      // FULL_FEATURE has both `country: 'United States'` and `countrycode: 'US'`.
      // Structured field uses the code; formatted string uses the full name.
      expect(result.address.country).toBe('US');
      expect(result.formattedAddress).toContain('United States');
    });

    it('throws "No reverse geocoding results found" on an empty feature list', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await expect(geocoder.reverseGeocode(0, 0)).rejects.toThrow(
        'No reverse geocoding results found',
      );
    });

    it('throws "Photon reverse returned <status>" on non-2xx upstream', async () => {
      fetchSpy.mockResolvedValueOnce(textResponse('rate limited', 429));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await expect(geocoder.reverseGeocode(0, 0)).rejects.toThrow(
        'Photon reverse returned 429: rate limited',
      );
    });
  });
});
