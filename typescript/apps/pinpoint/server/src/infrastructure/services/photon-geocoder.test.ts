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
    // Retries make extra calls; an un-queued call must fail loudly rather than
    // fall through to the real network.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
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

    it('returns the matched address as structured components, not just coordinates', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode(FULL_ADDRESS);

      // Components come from what Photon matched, not from the query — note
      // `suburb` is populated from the response `district` even though the
      // query address had none, and country is the ISO code.
      expect(result.address).toEqual({
        houseNumber: '548',
        road: 'Market Street',
        suburb: 'South of Market',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94104',
        country: 'US',
      });
    });

    it('falls back to `name` for city and tolerates missing components', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          features: [
            {
              geometry: { coordinates: [4.9, 52.37] as [number, number] },
              properties: { name: 'Amsterdam', country: 'Netherlands', countrycode: 'NL' },
            },
          ],
        }),
      );

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode({ ...FULL_ADDRESS, houseNumber: null, road: null });

      expect(result.address).toEqual({
        houseNumber: null,
        road: null,
        suburb: null,
        city: 'Amsterdam',
        state: null,
        postalCode: null,
        country: 'NL',
      });
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
      expect(parsed.searchParams.get('limit')).toBe('5');
    });

    // Self-hosted Photon indexes match country names but not ISO codes, so
    // `…, USA` returns nothing where `…, United States` matches. The resolver
    // widens the token at query time only.
    it('widens the country token via the resolver, leaving component order intact', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({
        baseUrl: BASE_URL,
        resolveCountryName: async (c) => (c === 'USA' ? 'United States' : null),
      });
      await geocoder.geocode(FULL_ADDRESS);

      const parsed = new URL(fetchSpy.mock.calls[0]![0] as URL);
      expect(parsed.searchParams.get('q')).toBe(
        '548, Market Street, San Francisco, CA, 94104, United States',
      );
    });

    // UNKNOWN is the marker libpostal's best-effort pass stores for a component
    // it could not identify. It is not data, so it must not become a search
    // term — `…, randburg, UNKNOWN` asks Photon to find a place called UNKNOWN.
    it('omits an unresolved country instead of querying for UNKNOWN', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await geocoder.geocode({ ...FULL_ADDRESS, country: 'UNKNOWN' });

      const parsed = new URL(fetchSpy.mock.calls[0]![0] as URL);
      expect(parsed.searchParams.get('q')).toBe('548, Market Street, San Francisco, CA, 94104');
    });

    it('omits an unresolved city too', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await geocoder.geocode({ ...FULL_ADDRESS, city: 'UNKNOWN' });

      const parsed = new URL(fetchSpy.mock.calls[0]![0] as URL);
      expect(parsed.searchParams.get('q')).toBe('548, Market Street, CA, 94104, USA');
    });

    it('does not consult the country resolver for an unresolved country', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));
      const resolveCountryName = vi.fn().mockResolvedValue('Nowhere');

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL, resolveCountryName });
      await geocoder.geocode({ ...FULL_ADDRESS, country: 'UNKNOWN' });

      expect(resolveCountryName).not.toHaveBeenCalled();
    });

    it('keeps the original country token when the resolver returns null', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({
        baseUrl: BASE_URL,
        resolveCountryName: async () => null,
      });
      await geocoder.geocode(FULL_ADDRESS);

      const parsed = new URL(fetchSpy.mock.calls[0]![0] as URL);
      expect(parsed.searchParams.get('q')).toBe('548, Market Street, San Francisco, CA, 94104, USA');
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

    it('throws "No geocoding results found" when every attempt comes back empty', async () => {
      fetchSpy.mockImplementation(async () => jsonResponse({ features: [] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      await expect(geocoder.geocode(FULL_ADDRESS)).rejects.toThrow('No geocoding results found');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
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
      const result = await geocoder.geocode({ ...FULL_ADDRESS, road: null });

      expect(result.confidence).toBeCloseTo(0.45, 5);
    });

    it('reports roadMatched null and searches once when no road was requested', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode({ ...FULL_ADDRESS, road: null });

      expect(result.roadMatched).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('reports the query that produced the result', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [FULL_FEATURE] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode(FULL_ADDRESS);

      expect(result.roadMatched).toBe(true);
      expect(result.query).toBe('548, Market Street, San Francisco, CA, 94104, USA');
    });
  });

  // Real-world failure (2026-10-15): the caller says "Blairgowrie, 2194"; OSM
  // files Curvy Road under Robin Acres, 2024. Photon ranks the suburb above
  // the road, so the top hit is a different street (or a school) in
  // Blairgowrie — ~1.2 km off.
  describe('wrong-road protection', () => {
    const CURVY: NormalizedAddress = {
      houseNumber: '16',
      road: 'Curvy Road',
      suburb: 'Blairgowrie',
      city: 'Randburg',
      state: 'Gauteng',
      postalCode: '2194',
      country: 'South Africa',
    };
    const CONDON_ROAD = {
      geometry: { coordinates: [28.0085371, -26.1081621] as [number, number] },
      properties: {
        type: 'street',
        osm_key: 'highway',
        name: 'Condon Road',
        district: 'Blairgowrie',
        city: 'Randburg',
        postcode: '1865',
        countrycode: 'ZA',
      },
    };
    const BLAIRGOWRIE_DRIVE = {
      geometry: { coordinates: [28.01, -26.11] as [number, number] },
      properties: {
        type: 'street',
        osm_key: 'highway',
        name: 'Blairgowrie Drive',
        city: 'Randburg',
        countrycode: 'ZA',
      },
    };
    const CURVY_ROAD = {
      geometry: { coordinates: [28.0122491, -26.1187533] as [number, number] },
      properties: {
        type: 'street',
        osm_key: 'highway',
        name: 'Curvy Road',
        district: 'Robin Acres',
        city: 'Randburg',
        postcode: '2024',
        countrycode: 'ZA',
      },
    };

    function queries(): string[] {
      return fetchSpy.mock.calls.map(([url]) => new URL(url as URL).searchParams.get('q')!);
    }

    it('skips a wrong-road top hit when a later candidate is on the requested road', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [CONDON_ROAD, CURVY_ROAD] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode(CURVY);

      expect(result.latitude).toBe(-26.1187533);
      expect(result.roadMatched).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('retries without suburb and postcode when no candidate is on the road', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ features: [CONDON_ROAD] }))
        .mockResolvedValueOnce(jsonResponse({ features: [CURVY_ROAD] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode(CURVY);

      expect(queries()).toEqual([
        '16, Curvy Road, Blairgowrie, Randburg, Gauteng, 2194, South Africa',
        '16, Curvy Road, Randburg, Gauteng, South Africa',
      ]);
      expect(result.roadMatched).toBe(true);
      expect(result.query).toBe('16, Curvy Road, Randburg, Gauteng, South Africa');
      // A street-level result carries the road in `name` — it is the road,
      // not the city.
      expect(result.address.road).toBe('Curvy Road');
      expect(result.address.city).toBe('Randburg');
      expect(result.formattedAddress).toBe('Curvy Road, Robin Acres, Randburg, 2024');
    });

    it('drops the house number last', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ features: [CONDON_ROAD] }))
        .mockResolvedValueOnce(jsonResponse({ features: [CONDON_ROAD] }))
        .mockResolvedValueOnce(jsonResponse({ features: [CURVY_ROAD] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode(CURVY);

      expect(queries()[2]).toBe('Curvy Road, Randburg, Gauteng, South Africa');
      expect(result.roadMatched).toBe(true);
    });

    it('falls back to the first top hit, flagged and without street credit, when every attempt misses', async () => {
      fetchSpy.mockImplementation(async () => jsonResponse({ features: [CONDON_ROAD] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode(CURVY);

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result.latitude).toBe(-26.1081621);
      expect(result.roadMatched).toBe(false);
      expect(result.query).toBe(
        '16, Curvy Road, Blairgowrie, Randburg, Gauteng, 2194, South Africa',
      );
      // city 0.25 + country 0.20 + postcode 0.10 — no street credit for Condon Road.
      expect(result.confidence).toBeCloseTo(0.55, 5);
    });

    it.each([
      ['abbreviated type', 'Curvy Rd'],
      ['house number folded into the road, type omitted', '16 Curvy'],
    ])('accepts the road when the request uses %s', async (_label, road) => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [CURVY_ROAD] }));

      const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
      const result = await geocoder.geocode({ ...CURVY, houseNumber: null, road });

      expect(result.roadMatched).toBe(true);
    });

    describe('free text', () => {
      const LINE = '16 Curvy Road, Blairgowrie, Randburg, 2194, South Africa';

      it('loosens the line — postcode first, then each middle segment — until a candidate is on a named road', async () => {
        fetchSpy
          .mockResolvedValueOnce(jsonResponse({ features: [CONDON_ROAD] }))
          .mockResolvedValueOnce(jsonResponse({ features: [CONDON_ROAD] }))
          .mockResolvedValueOnce(jsonResponse({ features: [CURVY_ROAD] }));

        const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
        const result = await geocoder.geocodeText(LINE);

        expect(queries()).toEqual([
          '16 Curvy Road, Blairgowrie, Randburg, 2194, South Africa',
          '16 Curvy Road, Blairgowrie, Randburg, South Africa',
          '16 Curvy Road, Randburg, South Africa',
        ]);
        expect(result.roadMatched).toBe(true);
        expect(result.latitude).toBe(-26.1187533);
      });

      it('strips a postcode trailing a segment', async () => {
        fetchSpy
          .mockResolvedValueOnce(jsonResponse({ features: [CONDON_ROAD] }))
          .mockResolvedValueOnce(jsonResponse({ features: [CURVY_ROAD] }));

        const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
        await geocoder.geocodeText('16 Curvy Road, Randburg 2194, South Africa');

        expect(queries()[1]).toBe('16 Curvy Road, Randburg, South Africa');
      });

      it('does not mistake a road named after the suburb for the requested road', async () => {
        fetchSpy.mockImplementation(async () =>
          jsonResponse({ features: [BLAIRGOWRIE_DRIVE] }),
        );

        const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
        const result = await geocoder.geocodeText(LINE);

        expect(result.roadMatched).toBe(false);
      });

      it('caps the number of upstream searches', async () => {
        fetchSpy.mockImplementation(async () => jsonResponse({ features: [CONDON_ROAD] }));

        const geocoder = createPhotonGeocoder({ baseUrl: BASE_URL });
        await geocoder.geocodeText('1 A Road, B, C, D, E, F, G, Country');

        expect(fetchSpy).toHaveBeenCalledTimes(5);
      });

      it('appends the country name from the hint when the line lacks it', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [CURVY_ROAD] }));

        const geocoder = createPhotonGeocoder({
          baseUrl: BASE_URL,
          resolveCountryName: async (c) => (c === 'ZA' ? 'South Africa' : null),
        });
        await geocoder.geocodeText('16 Curvy Road, Randburg', { countryCode: 'ZA' });

        expect(queries()[0]).toBe('16 Curvy Road, Randburg, South Africa');
      });

      it('leaves the line alone when it already names the hinted country', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [CURVY_ROAD] }));

        const geocoder = createPhotonGeocoder({
          baseUrl: BASE_URL,
          resolveCountryName: async () => 'South Africa',
        });
        await geocoder.geocodeText('16 Curvy Road, Randburg, south africa', { countryCode: 'ZA' });

        expect(queries()[0]).toBe('16 Curvy Road, Randburg, south africa');
      });
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
