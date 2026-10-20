/**
 * Google geocoder: request construction, response mapping, confidence, and
 * error mapping. `globalThis.fetch` is mocked — no real network, no key spent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import { createGoogleGeocoder } from './google-geocoder.js';

const KEY = 'test-secret-key';

const CURVY: NormalizedAddress = {
  houseNumber: '16',
  road: 'Curvy Road',
  suburb: 'Blairgowrie',
  city: 'Randburg',
  state: 'Gauteng',
  postalCode: '2194',
  country: 'ZA',
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    formatted_address: '16 Curvy Rd, Blairgowrie, Randburg, 2194, South Africa',
    address_components: [
      { long_name: '16', short_name: '16', types: ['street_number'] },
      { long_name: 'Curvy Road', short_name: 'Curvy Rd', types: ['route'] },
      {
        long_name: 'Blairgowrie',
        short_name: 'Blairgowrie',
        types: ['political', 'sublocality', 'sublocality_level_1'],
      },
      { long_name: 'Randburg', short_name: 'Randburg', types: ['locality', 'political'] },
      {
        long_name: 'Gauteng',
        short_name: 'GP',
        types: ['administrative_area_level_1', 'political'],
      },
      { long_name: 'South Africa', short_name: 'ZA', types: ['country', 'political'] },
      { long_name: '2194', short_name: '2194', types: ['postal_code'] },
    ],
    geometry: { location: { lat: -26.1123, lng: 28.0011 }, location_type: 'ROOFTOP' },
    ...overrides,
  };
}

function ok(...results: unknown[]): Response {
  return new Response(JSON.stringify({ status: 'OK', results }), { status: 200 });
}

async function errorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
}

function status(value: string, errorMessage?: string): Response {
  return new Response(JSON.stringify({ status: value, results: [], error_message: errorMessage }), {
    status: 200,
  });
}

describe('google-geocoder', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function calledUrl(n = 0): URL {
    return new URL(String(fetchSpy.mock.calls[n]![0]));
  }

  const geocoder = () => createGoogleGeocoder({ apiKey: KEY, baseUrl: 'https://google.example' });

  it('geocodes structured components with an ISO-2 country filter', async () => {
    fetchSpy.mockResolvedValueOnce(ok(result()));

    const r = await geocoder().geocode(CURVY);

    const url = calledUrl();
    expect(url.origin + url.pathname).toBe('https://google.example/maps/api/geocode/json');
    expect(url.searchParams.get('address')).toBe(
      '16 Curvy Road, Blairgowrie, Randburg, Gauteng, 2194',
    );
    expect(url.searchParams.get('components')).toBe('country:ZA');
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(r).toEqual({
      latitude: -26.1123,
      longitude: 28.0011,
      confidence: 0.95,
      formattedAddress: '16 Curvy Rd, Blairgowrie, Randburg, 2194, South Africa',
      address: {
        houseNumber: '16',
        road: 'Curvy Road',
        suburb: 'Blairgowrie',
        city: 'Randburg',
        state: 'Gauteng',
        postalCode: '2194',
        country: 'ZA',
      },
      roadMatched: true,
      query: '16 Curvy Road, Blairgowrie, Randburg, Gauteng, 2194',
      source: 'GOOGLE_MAPS',
    });
  });

  it('appends a non-ISO-2 country to the line (widened by the resolver) and skips unresolved parts', async () => {
    fetchSpy.mockResolvedValueOnce(ok(result()));
    const g = createGoogleGeocoder({
      apiKey: KEY,
      countryNames: async (c) => (c === 'ZAF' ? 'South Africa' : null),
    });

    await g.geocode({ ...CURVY, suburb: null, city: 'UNKNOWN', country: 'ZAF' });

    const url = calledUrl();
    expect(url.origin).toBe('https://maps.googleapis.com');
    expect(url.searchParams.get('address')).toBe('16 Curvy Road, Gauteng, 2194, South Africa');
    expect(url.searchParams.has('components')).toBe(false);
  });

  it('flags a result on another road and caps its confidence', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok(
        result({
          address_components: [
            { long_name: 'Condon Road', short_name: 'Condon Rd', types: ['route'] },
            { long_name: 'South Africa', short_name: 'ZA', types: ['country'] },
          ],
        }),
      ),
    );

    const r = await geocoder().geocode(CURVY);

    expect(r.roadMatched).toBe(false);
    expect(r.confidence).toBe(0.5);
    expect(r.address.houseNumber).toBeNull();
    expect(r.address.city).toBe('');
  });

  it.each([
    ['RANGE_INTERPOLATED', false, 0.85],
    ['GEOMETRIC_CENTER', false, 0.7],
    ['APPROXIMATE', false, 0.5],
    ['ROOFTOP', true, 0.85],
    [undefined, false, 0.5],
  ])('scores location_type %s (partial_match %s) as %s', async (type, partial, expected) => {
    fetchSpy.mockResolvedValueOnce(
      ok(
        result({
          geometry: { location: { lat: 1, lng: 2 }, location_type: type },
          partial_match: partial,
        }),
      ),
    );
    expect((await geocoder().geocode(CURVY)).confidence).toBe(expected);
  });

  it('geocodes free text with the country hint; roadMatched checks the line', async () => {
    fetchSpy.mockResolvedValueOnce(ok(result()));

    const r = await geocoder().geocodeText(' 16 Curvy Road, Blairgowrie, Randburg ', {
      countryCode: 'za',
    });

    const url = calledUrl();
    expect(url.searchParams.get('address')).toBe('16 Curvy Road, Blairgowrie, Randburg');
    expect(url.searchParams.get('components')).toBe('country:ZA');
    expect(r.roadMatched).toBe(true);
    expect(r.query).toBe('16 Curvy Road, Blairgowrie, Randburg');
  });

  it('free text: a route the line does not name is not road-matched; no route is null', async () => {
    fetchSpy.mockResolvedValueOnce(ok(result())).mockResolvedValueOnce(
      ok(
        result({
          address_components: [
            { long_name: 'Randburg', short_name: 'Randburg', types: ['locality'] },
          ],
        }),
      ),
    );

    expect((await geocoder().geocodeText('16 Condon Road, Randburg')).roadMatched).toBe(false);
    const cityOnly = await geocoder().geocodeText('Randburg');
    expect(cityOnly.roadMatched).toBeNull();
    expect(calledUrl(1).searchParams.has('components')).toBe(false);
  });

  it('reverse geocodes by latlng', async () => {
    fetchSpy.mockResolvedValueOnce(ok(result()));

    const r = await geocoder().reverseGeocode(-26.1, 28.0);

    expect(calledUrl().searchParams.get('latlng')).toBe('-26.1,28');
    expect(r.address.road).toBe('Curvy Road');
    expect(r.confidence).toBe(0.95);
  });

  it('maps ZERO_RESULTS to the "No geocoding results" error the routes turn into 422', async () => {
    fetchSpy.mockResolvedValueOnce(status('ZERO_RESULTS'));
    await expect(geocoder().geocode(CURVY)).rejects.toThrow(/^No geocoding results/);
  });

  it('reports other statuses without leaking the key', async () => {
    fetchSpy.mockResolvedValueOnce(status('REQUEST_DENIED', 'The provided API key is invalid.'));

    const err = await errorOf(geocoder().geocode(CURVY));

    expect(err.message).toBe(
      'Google geocoding failed: REQUEST_DENIED: The provided API key is invalid.',
    );
    expect(err.message).not.toContain(KEY);
  });

  it('reports HTTP and network failures without the URL', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(geocoder().geocode(CURVY)).rejects.toThrow('Google geocoding returned HTTP 503');
    const err = await errorOf(geocoder().geocodeText('x'));
    expect(err.message).toBe('Google geocoding request failed: fetch failed');
    expect(err.message).not.toContain(KEY);
  });
});
