import { describe, expect, it } from 'vitest';
import { createBackoff } from './reconnect.js';

describe('createBackoff', () => {
  it('stays within the doubling ceiling and the cap', () => {
    const backoff = createBackoff(1_000, 30_000);
    let previousCeiling = 0;
    for (let i = 0; i < 12; i++) {
      const delay = backoff.next();
      const ceiling = Math.min(30_000, 1_000 * 2 ** i) + 500;
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(ceiling);
      previousCeiling = ceiling;
    }
    expect(previousCeiling).toBe(30_500);
  });

  it('reset() drops back to the base window', () => {
    const backoff = createBackoff(1_000, 30_000);
    for (let i = 0; i < 8; i++) backoff.next();
    backoff.reset();
    expect(backoff.next()).toBeLessThanOrEqual(1_500);
  });
});
