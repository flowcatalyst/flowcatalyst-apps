import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addressLineHash, tidyAddressLine } from './address-line.js';

describe('tidyAddressLine', () => {
  it('lowercases, collapses whitespace and normalises segment separators', () => {
    expect(tidyAddressLine('  16  Curvy Road ,Blairgowrie,,  Randburg\t2194 , ZA , ')).toBe(
      '16 curvy road, blairgowrie, randburg 2194, za',
    );
  });

  it('is idempotent', () => {
    const once = tidyAddressLine('12 Bree St,  Cape Town');
    expect(tidyAddressLine(once)).toBe(once);
  });
});

describe('addressLineHash', () => {
  it('hashes the tidied line, so formatting differences collide', () => {
    expect(addressLineHash('16 Curvy Road,Randburg')).toBe(
      addressLineHash('  16 curvy road ,  randburg '),
    );
  });

  it('is the SHA-256 hex of the tidied line — the SQL rehash migration relies on this', () => {
    expect(addressLineHash('16 Curvy Road, Randburg')).toBe(
      createHash('sha256').update('16 curvy road, randburg').digest('hex'),
    );
  });

  it('distinguishes different addresses', () => {
    expect(addressLineHash('16 curvy road, randburg')).not.toBe(
      addressLineHash('18 curvy road, randburg'),
    );
  });
});
