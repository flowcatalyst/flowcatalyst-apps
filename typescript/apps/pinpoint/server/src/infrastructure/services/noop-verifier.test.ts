import { describe, expect, it } from 'vitest';
import { createNoopVerifier } from './noop-verifier.js';

describe('noop-verifier', () => {
  it('always returns null', async () => {
    const verifier = createNoopVerifier();

    expect(await verifier.verify('input', 'candidate')).toBeNull();
    expect(await verifier.verify('', '')).toBeNull();
  });
});
