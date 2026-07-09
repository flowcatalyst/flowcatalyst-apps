import { describe, expect, it } from 'vitest';
import { hashSecret, randomToken, verifySecret } from './pick-credentials.js';

describe('pick-credentials', () => {
  it('round-trips a secret', async () => {
    const hash = await hashSecret('123456');
    expect(hash).toMatch(/^s0\$/);
    expect(await verifySecret('123456', hash)).toBe(true);
  });

  it('rejects a wrong secret', async () => {
    const hash = await hashSecret('123456');
    expect(await verifySecret('000000', hash)).toBe(false);
  });

  it('salts randomly — same input hashes differently, both verify', async () => {
    const a = await hashSecret('123456');
    const b = await hashSecret('123456');
    expect(a).not.toBe(b);
    expect(await verifySecret('123456', a)).toBe(true);
    expect(await verifySecret('123456', b)).toBe(true);
  });

  it('returns false (never throws) for a malformed hash', async () => {
    expect(await verifySecret('x', 'not-a-valid-hash')).toBe(false);
    expect(await verifySecret('x', '')).toBe(false);
    expect(await verifySecret('x', 's0$16384$8$1$bad')).toBe(false);
  });

  it('randomToken is url-safe and unique', () => {
    const t1 = randomToken();
    const t2 = randomToken();
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
