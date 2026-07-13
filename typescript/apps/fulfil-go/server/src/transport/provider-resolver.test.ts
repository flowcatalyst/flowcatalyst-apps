import { describe, expect, it } from 'vitest';
import { TRANSPORT_SETTINGS_DEFAULTS } from '@fulfil-go/shared';
import { EPOD_CHANNEL, OWN_CHANNEL, createProviderRegistry } from './adapter-registry.js';
import { haversineKm, resolveProviders } from './provider-resolver.js';

const UBER_CHANNEL = {
  code: 'uber',
  kind: 'provider-planned',
  capabilities: { vehicleGuarantee: false },
} as const;

const registry = createProviderRegistry([OWN_CHANNEL, EPOD_CHANNEL, UBER_CHANNEL]);

const JHB = { lat: -26.2041, lng: 28.0473 };
const NEARBY = { lat: -26.21, lng: 28.06 }; // ~1.5km
const CAPE_TOWN = { lat: -33.9249, lng: 18.4241 };

function settings(overrides: object) {
  return { ...TRANSPORT_SETTINGS_DEFAULTS, ...overrides };
}

describe('haversineKm', () => {
  it('measures real-world distances sanely', () => {
    expect(haversineKm(JHB, NEARBY)).toBeGreaterThan(1);
    expect(haversineKm(JHB, NEARBY)).toBeLessThan(3);
    expect(haversineKm(JHB, CAPE_TOWN)).toBeGreaterThan(1200);
  });
});

describe('resolveProviders', () => {
  it('empty allowed list means nothing is serviceable', () => {
    const resolved = resolveProviders({
      settings: settings({}),
      registry,
      requiresVehicle: false,
      storeGeo: JHB,
      dropoffGeo: NEARBY,
    });
    expect(resolved.candidates).toEqual([]);
  });

  it('keeps allowed order and puts the store default first', () => {
    const resolved = resolveProviders({
      settings: settings({
        transportProviders: [{ code: 'uber' }, { code: 'own' }, { code: 'epod' }],
        defaultTransportProvider: 'own',
      }),
      registry,
      requiresVehicle: false,
      storeGeo: JHB,
      dropoffGeo: NEARBY,
    });
    expect(resolved.candidates).toEqual(['own', 'uber', 'epod']);
  });

  it('filters providers that cannot guarantee a vehicle when required', () => {
    const resolved = resolveProviders({
      settings: settings({ transportProviders: [{ code: 'uber' }, { code: 'own' }] }),
      registry,
      requiresVehicle: true,
      storeGeo: JHB,
      dropoffGeo: NEARBY,
    });
    expect(resolved.candidates).toEqual(['own']);
    expect(resolved.rejected).toEqual([{ code: 'uber', reason: 'cannot guarantee a vehicle' }]);
  });

  it('coverage radius excludes far dropoffs and FAILS CLOSED on missing geo', () => {
    const base = {
      settings: settings({ transportProviders: [{ code: 'uber', serviceRadiusKm: 10 }] }),
      registry,
      requiresVehicle: false,
    };
    expect(
      resolveProviders({ ...base, storeGeo: JHB, dropoffGeo: NEARBY }).candidates,
    ).toEqual(['uber']);
    expect(
      resolveProviders({ ...base, storeGeo: JHB, dropoffGeo: CAPE_TOWN }).candidates,
    ).toEqual([]);
    expect(resolveProviders({ ...base, storeGeo: JHB, dropoffGeo: null }).candidates).toEqual([]);
  });

  it('rejects unregistered provider codes', () => {
    const resolved = resolveProviders({
      settings: settings({ transportProviders: [{ code: 'carrier-pigeon' }] }),
      registry,
      requiresVehicle: false,
      storeGeo: null,
      dropoffGeo: null,
    });
    expect(resolved.candidates).toEqual([]);
    expect(resolved.rejected[0]?.reason).toBe('not a registered provider');
  });
});
