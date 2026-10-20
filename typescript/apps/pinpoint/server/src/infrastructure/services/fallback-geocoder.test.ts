/**
 * Photon → Google fallback: when the fallback is consulted, which result wins,
 * and how failures on either side surface.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedAddress } from '../../domain/services/address-normalizer.js';
import type { GeocoderService, GeocodingResult } from '../../domain/services/geocoder.js';
import { createFallbackGeocoder, lineWantsHouse, wantsHouse } from './fallback-geocoder.js';

const ADDRESS: NormalizedAddress = {
  houseNumber: '16',
  road: 'Curvy Road',
  suburb: 'Blairgowrie',
  city: 'Randburg',
  state: 'Gauteng',
  postalCode: '2194',
  country: 'ZA',
};

function result(
  source: GeocodingResult['source'],
  overrides: { houseNumber?: string | null; roadMatched?: boolean | null } = {},
): GeocodingResult {
  return {
    latitude: source === 'PHOTON' ? 1 : 2,
    longitude: 0,
    confidence: 0.8,
    formattedAddress: null,
    address: {
      ...ADDRESS,
      houseNumber: overrides.houseNumber === undefined ? '16' : overrides.houseNumber,
    },
    roadMatched: overrides.roadMatched === undefined ? true : overrides.roadMatched,
    query: 'q',
    source,
  };
}

type Outcome = GeocodingResult | Error;

function fake(outcome: Outcome) {
  const run = vi.fn(async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const service: GeocoderService = {
    geocode: run,
    geocodeText: run,
    reverseGeocode: vi.fn(async () => ({
      address: ADDRESS,
      formattedAddress: 'x',
      confidence: 1,
    })),
  };
  return { service, run };
}

function build(primary: Outcome, fallback: Outcome) {
  const p = fake(primary);
  const f = fake(fallback);
  const onFallback = vi.fn();
  const onError = vi.fn();
  const geocoder = createFallbackGeocoder(p.service, f.service, { onFallback, onError });
  return { geocoder, p, f, onFallback, onError };
}

describe('wantsHouse / lineWantsHouse', () => {
  it.each([
    [{ houseNumber: '16', road: 'Curvy Road' }, true],
    [{ houseNumber: null, road: '16 Curvy' }, true],
    [{ houseNumber: ' ', road: '16a Curvy Road' }, true],
    [{ houseNumber: null, road: 'Curvy Road' }, false],
    [{ houseNumber: null, road: null }, false],
  ])('structured %o → %s', (parts, expected) => {
    expect(wantsHouse({ ...ADDRESS, ...parts })).toBe(expected);
  });

  it.each([
    ['16 Curvy Road, Blairgowrie, Randburg', true],
    ['16a Curvy Road, Randburg', true],
    ['16-18 Main Road, Cape Town', true],
    ['Curvy Road 16, Randburg', false],
    ['Clicks Rosebank, 16 Curvy Road', false],
    ['Randburg', false],
  ])('text %s → %s', (line, expected) => {
    expect(lineWantsHouse(line)).toBe(expected);
  });
});

describe('createFallbackGeocoder', () => {
  it('keeps a good primary result without calling the fallback', async () => {
    const { geocoder, f, onFallback } = build(result('PHOTON'), result('GOOGLE_MAPS'));

    expect((await geocoder.geocode(ADDRESS)).source).toBe('PHOTON');
    expect(f.run).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('street-level primary without the house number → fallback with one wins', async () => {
    const { geocoder, onFallback } = build(
      result('PHOTON', { houseNumber: null }),
      result('GOOGLE_MAPS'),
    );

    expect((await geocoder.geocode(ADDRESS)).source).toBe('GOOGLE_MAPS');
    expect(onFallback).toHaveBeenCalledWith('primary result has no house number');
  });

  it('a street-level primary is fine when no house number was asked for', async () => {
    const { geocoder, f } = build(result('PHOTON', { houseNumber: null }), result('GOOGLE_MAPS'));

    const r = await geocoder.geocode({ ...ADDRESS, houseNumber: null });

    expect(r.source).toBe('PHOTON');
    expect(f.run).not.toHaveBeenCalled();
  });

  it('primary on the wrong road → fallback on the right one wins', async () => {
    const { geocoder, onFallback } = build(
      result('PHOTON', { roadMatched: false }),
      result('GOOGLE_MAPS'),
    );

    expect((await geocoder.geocode(ADDRESS)).source).toBe('GOOGLE_MAPS');
    expect(onFallback).toHaveBeenCalledWith('primary result not on the requested road');
  });

  it('a fallback that is no better loses to the primary', async () => {
    const { geocoder } = build(
      result('PHOTON', { houseNumber: null }),
      result('GOOGLE_MAPS', { roadMatched: false }),
    );

    expect((await geocoder.geocode(ADDRESS)).source).toBe('PHOTON');
  });

  it('primary failed → the fallback result is used even when it is short', async () => {
    const { geocoder, onFallback } = build(
      new Error('Photon request to https://photon failed (ECONNREFUSED)'),
      result('GOOGLE_MAPS', { houseNumber: null }),
    );

    expect((await geocoder.geocode(ADDRESS)).source).toBe('GOOGLE_MAPS');
    expect(onFallback.mock.calls[0]![0]).toMatch(/^primary failed: Photon request/);
  });

  it('fallback failure is reported and the primary result stands', async () => {
    const boom = new Error('Google geocoding failed: OVER_QUERY_LIMIT');
    const { geocoder, onError } = build(result('PHOTON', { houseNumber: null }), boom);

    expect((await geocoder.geocode(ADDRESS)).source).toBe('PHOTON');
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('both fail → a "No geocoding results" error is preferred (keeps the 422)', async () => {
    const none = new Error('No geocoding results found');
    const down = new Error('Google geocoding failed: REQUEST_DENIED');

    await expect(build(none, down).geocoder.geocode(ADDRESS)).rejects.toBe(none);
    const photonDown = new Error('Photon search returned 500: ');
    await expect(build(photonDown, none).geocoder.geocode(ADDRESS)).rejects.toBe(none);
    await expect(build(photonDown, down).geocoder.geocode(ADDRESS)).rejects.toBe(photonDown);
  });

  it('geocodeText falls back on the same rules, passing the options through', async () => {
    const { geocoder, p, f } = build(
      result('PHOTON', { houseNumber: null }),
      result('GOOGLE_MAPS'),
    );

    const r = await geocoder.geocodeText('16 Curvy Road, Randburg', { countryCode: 'ZA' });

    expect(r.source).toBe('GOOGLE_MAPS');
    expect(p.run).toHaveBeenCalledWith('16 Curvy Road, Randburg', { countryCode: 'ZA' });
    expect(f.run).toHaveBeenCalledWith('16 Curvy Road, Randburg', { countryCode: 'ZA' });
  });

  it('geocodeText without a leading number keeps a street-level primary', async () => {
    const { geocoder, f } = build(result('PHOTON', { houseNumber: null }), result('GOOGLE_MAPS'));

    expect((await geocoder.geocodeText('Curvy Road, Randburg')).source).toBe('PHOTON');
    expect(f.run).not.toHaveBeenCalled();
  });

  it('reverse geocodes with the primary only', async () => {
    const { geocoder, p, f } = build(result('PHOTON'), result('GOOGLE_MAPS'));

    await geocoder.reverseGeocode(1, 2);

    expect(p.service.reverseGeocode).toHaveBeenCalledWith(1, 2);
    expect(f.service.reverseGeocode).not.toHaveBeenCalled();
  });
});
