import { describe, expect, it } from 'vitest';
import {
  PICK_SETTINGS_DEFAULTS,
  TransportStoreSettingsSchema,
  resolvePickStoreSettings,
  resolveTransportStoreSettings,
} from '@fulfil-go/shared';

/**
 * Layered store-settings resolution, split by owning domain (Andrew,
 * 2026-07-13): pick settings and transport settings resolve independently
 * through their own profile chains. The resolver infrastructure
 * (profile/override loading) is exercised end-to-end by the
 * create-fulfilment path; the merge itself is pure and tested here.
 */
describe('transport store settings — execution-system fields', () => {
  it('defaults to no execution systems and a null default system', () => {
    const resolved = resolveTransportStoreSettings();
    expect(resolved.executionSystems).toEqual([]);
    expect(resolved.defaultExecutionSystem).toBeNull();
    expect(resolved.defaultTransportProvider).toBeNull();
    expect(resolved.transportProviders).toEqual([]);
  });

  it('arrays pass through layers wholesale (replace, never merge)', () => {
    const resolved = resolveTransportStoreSettings(
      { executionSystems: ['own', 'uber'] }, // 'default' profile
      { executionSystems: ['epod'] }, // store's profile wins per field
    );
    expect(resolved.executionSystems).toEqual(['epod']);
  });

  it('a later layer sets defaultExecutionSystem without disturbing others', () => {
    const resolved = resolveTransportStoreSettings(
      { transportLeadTimeMinutes: 60 },
      { defaultExecutionSystem: 'epod' },
    );
    expect(resolved.defaultExecutionSystem).toBe('epod');
    expect(resolved.transportLeadTimeMinutes).toBe(60);
    expect(resolved.executionSystems).toEqual([]);
  });

  it('zod accepts provider entries and rejects malformed values', () => {
    expect(
      TransportStoreSettingsSchema.safeParse({
        executionSystems: ['epod', 'own'],
        defaultExecutionSystem: 'epod',
        transportProviders: [{ code: 'uber', serviceRadiusKm: 12 }],
        defaultTransportProvider: 'uber',
      }).success,
    ).toBe(true);
    expect(TransportStoreSettingsSchema.safeParse({ executionSystems: 'epod' }).success).toBe(
      false,
    );
    expect(TransportStoreSettingsSchema.safeParse({ defaultExecutionSystem: '' }).success).toBe(
      false,
    );
    expect(TransportStoreSettingsSchema.safeParse({ unknownField: 1 }).success).toBe(false);
    expect(
      TransportStoreSettingsSchema.safeParse({ transportProviders: [{ serviceRadiusKm: 5 }] })
        .success,
    ).toBe(false);
  });
});

describe('pick store settings', () => {
  it('a layer that says nothing about a field inherits it', () => {
    const resolved = resolvePickStoreSettings(
      { pickSortAlgorithm: 'temperature-zone', pickLeadTimeMinutesDelivery: 120 },
      { pickClaimSlaMinutes: 30 }, // store override, silent on the rest
    );
    expect(resolved.pickSortAlgorithm).toBe('temperature-zone');
    expect(resolved.pickLeadTimeMinutesDelivery).toBe(120);
    expect(resolved.pickClaimSlaMinutes).toBe(30);
    expect(resolved.releaseOverdueMinutes).toBe(PICK_SETTINGS_DEFAULTS.releaseOverdueMinutes);
  });

  it('defaultPackMode: bags globally, profile can override to items', () => {
    expect(resolvePickStoreSettings().defaultPackMode).toBe('bags');
    expect(resolvePickStoreSettings({ defaultPackMode: 'items' }).defaultPackMode).toBe('items');
    // A silent store layer inherits the profile's override.
    expect(resolvePickStoreSettings({ defaultPackMode: 'items' }, {}).defaultPackMode).toBe(
      'items',
    );
  });
});
