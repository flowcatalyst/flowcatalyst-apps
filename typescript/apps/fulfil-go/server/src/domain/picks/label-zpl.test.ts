import { describe, expect, it } from 'vitest';
import { DEFAULT_LABEL_DIMENSIONS, renderBagLabelZpl } from './label-zpl.js';

const input = {
  shortId: '1042',
  storeRef: 'store-042',
  slotStart: new Date('2026-07-13T12:30:00Z'),
  timezone: 'Africa/Johannesburg',
  ref: 'pkg_0ABCDEF123456',
  seq: 2,
  count: 3,
};

describe('renderBagLabelZpl', () => {
  it('renders a well-formed label with barcode, bag number and slot time', () => {
    const zpl = renderBagLabelZpl(input, DEFAULT_LABEL_DIMENSIONS);
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.endsWith('^XZ')).toBe(true);
    expect(zpl).toContain('^CI28');
    // 100mm @ 203dpi ≈ 799 dots.
    expect(zpl).toContain('^PW799');
    expect(zpl).toContain('^BCN'); // Code 128
    expect(zpl).toContain('^FDpkg_0ABCDEF123456^FS');
    expect(zpl).toContain('^FD2 / 3^FS');
    expect(zpl).toContain('^FD#1042^FS');
    // Slot rendered in the pick's timezone (UTC+2).
    expect(zpl).toContain('14:30');
  });

  it('scales dots with dpi', () => {
    const zpl300 = renderBagLabelZpl(input, { ...DEFAULT_LABEL_DIMENSIONS, dpi: 300 });
    expect(zpl300).toContain('^PW1181');
  });

  it('escapes ZPL control characters in field data', () => {
    const zpl = renderBagLabelZpl({ ...input, storeRef: 'store^west~1' }, DEFAULT_LABEL_DIMENSIONS);
    expect(zpl).toContain('store\\^west\\~1');
  });
});
