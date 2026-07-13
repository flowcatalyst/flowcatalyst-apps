import { describe, expect, it } from 'vitest';
import {
  STORE_SETTINGS_DEFAULTS,
  StoreSettingsSchema,
  resolveStoreSettings,
} from '@fulfil-go/shared';

/**
 * Layered store-settings resolution — focused on the execution-system
 * fields added for the EPOD channel (transport-context.md). The resolver
 * infrastructure (profile/override loading) is exercised end-to-end by the
 * create-fulfilment path; the merge itself is pure and tested here.
 */
describe('store settings — execution-system fields', () => {
  it('defaults to no execution systems and a null default system', () => {
    const resolved = resolveStoreSettings();
    expect(resolved.executionSystems).toEqual([]);
    expect(resolved.defaultExecutionSystem).toBeNull();
    // Numeric defaults untouched by the new fields.
    expect(resolved.pickLeadTimeMinutesDelivery).toBe(
      STORE_SETTINGS_DEFAULTS.pickLeadTimeMinutesDelivery,
    );
  });

  it('arrays pass through layers wholesale (replace, never merge)', () => {
    const resolved = resolveStoreSettings(
      { executionSystems: ['own', 'uber'] }, // 'default' profile
      { executionSystems: ['epod'] }, // store's profile wins per field
    );
    expect(resolved.executionSystems).toEqual(['epod']);
  });

  it('a later layer sets defaultExecutionSystem without disturbing numerics', () => {
    const resolved = resolveStoreSettings(
      { pickLeadTimeMinutesDelivery: 120 },
      { defaultExecutionSystem: 'epod' },
    );
    expect(resolved.defaultExecutionSystem).toBe('epod');
    expect(resolved.pickLeadTimeMinutesDelivery).toBe(120);
    expect(resolved.executionSystems).toEqual([]);
  });

  it('a layer that says nothing about execution systems inherits them', () => {
    const resolved = resolveStoreSettings(
      { executionSystems: ['epod'], defaultExecutionSystem: 'epod' },
      { pickClaimSlaMinutes: 30 }, // store override, silent on execution
    );
    expect(resolved.executionSystems).toEqual(['epod']);
    expect(resolved.defaultExecutionSystem).toBe('epod');
    expect(resolved.pickClaimSlaMinutes).toBe(30);
  });

  it('zod accepts the new fields and still rejects malformed values', () => {
    expect(
      StoreSettingsSchema.safeParse({
        executionSystems: ['epod', 'own'],
        defaultExecutionSystem: 'epod',
      }).success,
    ).toBe(true);
    expect(StoreSettingsSchema.safeParse({ executionSystems: 'epod' }).success).toBe(false);
    expect(StoreSettingsSchema.safeParse({ defaultExecutionSystem: '' }).success).toBe(false);
    expect(StoreSettingsSchema.safeParse({ unknownField: 1 }).success).toBe(false);
  });
});
