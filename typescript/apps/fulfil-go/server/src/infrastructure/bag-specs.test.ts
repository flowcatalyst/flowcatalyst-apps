import { describe, expect, it } from 'vitest';
import {
  BAG_SPECS_DEFAULTS,
  fitBagSize,
  resolveBagSpecs,
  resolveClientSettings,
  resolvePickStoreSettings,
} from '@fulfil-go/shared';

describe('bag specs resolution (docs/bag-sizing.md)', () => {
  it('per-size merge: a sparse overlay keeps unnamed sizes on defaults', () => {
    const resolved = resolveBagSpecs({
      M: { dims: { lengthMm: 420, widthMm: 320, heightMm: 260 }, units: 4 },
    });
    expect(resolved.M.units).toBe(4);
    expect(resolved.M.dims.lengthMm).toBe(420);
    expect(resolved.XS).toEqual(BAG_SPECS_DEFAULTS.XS);
  });

  it('legacy packageUnitSizes overlays units; bagSpecs wins; resolved units view derives', () => {
    const resolved = resolveClientSettings({
      packageUnitSizes: { S: 5 },
      bagSpecs: { M: { dims: { lengthMm: 500, widthMm: 400, heightMm: 300 }, units: 9 } },
    });
    expect(resolved.bagSpecs.S.units).toBe(5); // legacy honoured
    expect(resolved.bagSpecs.S.dims).toEqual(BAG_SPECS_DEFAULTS.S.dims);
    expect(resolved.bagSpecs.M.units).toBe(9); // bagSpecs wins
    expect(resolved.packageUnitSizes['S']).toBe(5); // derived view, no drift
    expect(resolved.packageUnitSizes['M']).toBe(9);
  });

  it('pick settings: construction map merges per temperature', () => {
    const resolved = resolvePickStoreSettings({ constructionByTemperature: { hot: 'standard' } });
    expect(resolved.constructionByTemperature.hot).toBe('standard');
    expect(resolved.constructionByTemperature.frozen).toBe('insulated-gel');
    expect(resolved.bagSpecs.XL).toEqual(BAG_SPECS_DEFAULTS.XL);
  });
});

describe('fitBagSize', () => {
  const specs = BAG_SPECS_DEFAULTS;

  it('finds the smallest size that contains the item (rotation allowed)', () => {
    // 240×140×90 fits XS (250×200×150) once rotated.
    expect(fitBagSize({ lengthMm: 90, widthMm: 240, heightMm: 140 }, specs)).toBe('XS');
    // A tote-sized item needs M.
    expect(fitBagSize({ lengthMm: 390, widthMm: 290, heightMm: 240 }, specs)).toBe('M');
  });

  it('null when bigger than the largest bag (oversize/loose handling)', () => {
    expect(fitBagSize({ lengthMm: 700, widthMm: 500, heightMm: 500 }, specs)).toBeNull();
  });
});
