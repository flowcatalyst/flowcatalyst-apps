/**
 * LibPostalNormalizer tests. Mocks `globalThis.fetch` so we don't depend
 * on a running pelias/libpostal-service sidecar in CI. Pinning the
 * extraction order + the country-fallback heuristic — both are
 * load-bearing for the create-location pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createLibPostalNormalizer } from './libpostal-normalizer.js';

const BASE_URL = 'http://libpostal.example';

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

function parseHit(label: string, value: string): { label: string; value: string } {
  return { label, value };
}

describe('libpostal-normalizer', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('extracts the full set of components from a happy-path /parse response', async () => {
    fetchSpy
      // /parse
      .mockResolvedValueOnce(
        jsonResponse([
          parseHit('house_number', '548'),
          parseHit('road', 'market street'),
          parseHit('suburb', 'south of market'),
          parseHit('city', 'san francisco'),
          parseHit('state', 'ca'),
          parseHit('postcode', '94104'),
          parseHit('country', 'united states'),
        ]),
      )
      // /expand on the road — keep the parsed value
      .mockResolvedValueOnce(jsonResponse(['market street']));

    const normalizer = createLibPostalNormalizer({ baseUrl: BASE_URL });
    const result = await normalizer.normalize(
      '548 Market St, South of Market, San Francisco, CA 94104, United States',
    );

    expect(result).toEqual({
      houseNumber: '548',
      road: 'market street',
      suburb: 'south of market',
      city: 'san francisco',
      state: 'ca',
      postalCode: '94104',
      country: 'united states',
    });
  });

  it('falls back to state_district when /parse omits city', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse([
          parseHit('road', 'main street'),
          parseHit('state_district', 'gauteng'),
          parseHit('country', 'south africa'),
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(['main street']));

    const normalizer = createLibPostalNormalizer({ baseUrl: BASE_URL });
    const result = await normalizer.normalize('Main Street, Gauteng, South Africa');

    expect(result.city).toBe('gauteng');
    expect(result.country).toBe('south africa');
  });

  it('falls back to the last comma-segment when /parse omits country', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse([
          parseHit('road', 'main street'),
          parseHit('city', 'cape town'),
          // No country!
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(['main street']));

    const normalizer = createLibPostalNormalizer({ baseUrl: BASE_URL });
    const result = await normalizer.normalize('Main Street, Cape Town, South Africa');

    expect(result.country).toBe('South Africa');
  });

  it('expands the road via /expand when an expansion comes back', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse([
          parseHit('road', 'main st'),
          parseHit('city', 'cape town'),
          parseHit('country', 'za'),
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(['main street']));

    const normalizer = createLibPostalNormalizer({ baseUrl: BASE_URL });
    const result = await normalizer.normalize('Main St, Cape Town, ZA');

    expect(result.road).toBe('main street');
  });

  it('keeps the parsed road when /expand fails', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse([
          parseHit('road', 'main st'),
          parseHit('city', 'cape town'),
          parseHit('country', 'za'),
        ]),
      )
      .mockResolvedValueOnce(textResponse('expand broke', 500));

    const normalizer = createLibPostalNormalizer({ baseUrl: BASE_URL });
    const result = await normalizer.normalize('Main St, Cape Town, ZA');

    expect(result.road).toBe('main st');
  });

  it('throws when /parse returns non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(textResponse('parse broke', 500));

    const normalizer = createLibPostalNormalizer({ baseUrl: BASE_URL });
    await expect(normalizer.normalize('whatever')).rejects.toThrow('libpostal /parse returned 500');
  });

  it('throws when no city can be identified', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([parseHit('country', 'za')]));

    const normalizer = createLibPostalNormalizer({ baseUrl: BASE_URL });
    await expect(normalizer.normalize('no city here')).rejects.toThrow(
      'libpostal could not identify a city',
    );
  });

  it('throws when no country can be identified (parse + fallback both empty)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([parseHit('city', 'springfield')]));

    const normalizer = createLibPostalNormalizer({ baseUrl: BASE_URL });
    await expect(normalizer.normalize('')).rejects.toThrow(
      'libpostal could not identify a country',
    );
  });

  it('strips a trailing slash from baseUrl', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([parseHit('city', 'a'), parseHit('country', 'b')]));

    const normalizer = createLibPostalNormalizer({ baseUrl: `${BASE_URL}/` });
    await normalizer.normalize('a, b');

    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/^http:\/\/libpostal\.example\/parse\?/);
  });
});
