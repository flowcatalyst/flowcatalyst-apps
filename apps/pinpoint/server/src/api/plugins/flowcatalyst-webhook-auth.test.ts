/**
 * Pure HMAC verification tests. The hook layer (Fastify preHandler) is
 * mostly request/reply plumbing — exercised end-to-end via the
 * jobs route smoke. These tests pin the verification rules: header
 * presence, timestamp window, signature mismatch.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyFlowCatalystSignature } from './flowcatalyst-webhook-auth.js';

const SECRET = 'shhh';
const BODY = '{"hello":"world"}';
const NOW = 1_700_000_000;

function sign(body: string, timestamp: number, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}${body}`).digest('hex');
}

const nowFn = () => NOW;

describe('verifyFlowCatalystSignature', () => {
  it('returns ok=true when signature, timestamp, and body match', () => {
    const signature = sign(BODY, NOW);
    const result = verifyFlowCatalystSignature(BODY, signature, String(NOW), SECRET, {
      nowSeconds: nowFn,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when the signature header is missing', () => {
    const result = verifyFlowCatalystSignature(BODY, undefined, String(NOW), SECRET, {
      nowSeconds: nowFn,
    });
    expect(result).toEqual({
      ok: false,
      code: 'MISSING_SIGNATURE',
      message: expect.stringContaining('Signature'),
    });
  });

  it('rejects when the timestamp header is missing', () => {
    const signature = sign(BODY, NOW);
    const result = verifyFlowCatalystSignature(BODY, signature, undefined, SECRET, {
      nowSeconds: nowFn,
    });
    expect(result).toEqual({
      ok: false,
      code: 'MISSING_TIMESTAMP',
      message: expect.stringContaining('Timestamp'),
    });
  });

  it('rejects when the timestamp is not a number', () => {
    const signature = sign(BODY, NOW);
    const result = verifyFlowCatalystSignature(BODY, signature, 'not-a-number', SECRET, {
      nowSeconds: nowFn,
    });
    expect(result).toEqual({
      ok: false,
      code: 'TIMESTAMP_INVALID',
      message: expect.stringContaining('not a valid number'),
    });
  });

  it('rejects a timestamp older than the tolerance window (default 300s)', () => {
    // Sign for a timestamp 301 seconds in the past.
    const old = NOW - 301;
    const signature = sign(BODY, old);
    const result = verifyFlowCatalystSignature(BODY, signature, String(old), SECRET, {
      nowSeconds: nowFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TIMESTAMP_EXPIRED');
  });

  it('rejects a timestamp further in the future than the grace window (default 60s)', () => {
    const future = NOW + 61;
    const signature = sign(BODY, future);
    const result = verifyFlowCatalystSignature(BODY, signature, String(future), SECRET, {
      nowSeconds: nowFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TIMESTAMP_FUTURE');
  });

  it('rejects when the signature is signed with a different secret', () => {
    const signature = sign(BODY, NOW, 'wrong-secret');
    const result = verifyFlowCatalystSignature(BODY, signature, String(NOW), SECRET, {
      nowSeconds: nowFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects when the body has been tampered with', () => {
    const signature = sign(BODY, NOW);
    const tamperedBody = `${BODY}/* injected */`;
    const result = verifyFlowCatalystSignature(tamperedBody, signature, String(NOW), SECRET, {
      nowSeconds: nowFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects a length-mismatched signature without throwing on timingSafeEqual', () => {
    // timingSafeEqual requires equal-length buffers — guard against the
    // pre-check that returns MISMATCH before the constant-time compare.
    const result = verifyFlowCatalystSignature(BODY, 'short', String(NOW), SECRET, {
      nowSeconds: nowFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SIGNATURE_MISMATCH');
  });

  it('honors a custom toleranceSeconds for back-dated signatures', () => {
    const old = NOW - 600;
    const signature = sign(BODY, old);
    const ok = verifyFlowCatalystSignature(BODY, signature, String(old), SECRET, {
      nowSeconds: nowFn,
      toleranceSeconds: 900,
    });
    expect(ok.ok).toBe(true);
  });
});
