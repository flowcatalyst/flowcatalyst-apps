/**
 * Stability tests for the domain-side bits: the user prompt format and
 * the schema shape. Both ride into the LLM verbatim, so changes here
 * silently change verifier behavior — pin them.
 */
import { describe, expect, it } from 'vitest';
import {
  VERIFIER_SYSTEM_PROMPT,
  VerificationResultSchema,
  buildVerifierPrompt,
} from './address-verifier.js';

describe('buildVerifierPrompt', () => {
  it('emits the Rust-compatible "Input address / Candidate address" shape', () => {
    expect(buildVerifierPrompt('123 Main St, SF', '123 Main Street, San Francisco')).toBe(
      'Input address: "123 Main St, SF"\nCandidate address: "123 Main Street, San Francisco"\n\nAre these the same physical location?',
    );
  });

  it('quotes addresses literally — embedded quotes are caller responsibility', () => {
    // Documenting the current behavior: callers must not pass user-supplied
    // text containing double-quote characters. Slice 8's matching pipeline
    // passes already-normalized address lines, so this is fine in practice.
    const prompt = buildVerifierPrompt('a"b', 'c"d');
    expect(prompt).toContain('Input address: "a"b"');
  });
});

describe('VerificationResultSchema', () => {
  it('accepts a full valid verdict', () => {
    expect(
      VerificationResultSchema.parse({
        match_confirmed: true,
        confidence: 0.8,
        reasoning: 'Same street and city, different suffix.',
      }),
    ).toEqual({
      match_confirmed: true,
      confidence: 0.8,
      reasoning: 'Same street and city, different suffix.',
    });
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(() =>
      VerificationResultSchema.parse({
        match_confirmed: true,
        confidence: 1.5,
        reasoning: '.',
      }),
    ).toThrow();
  });

  it('rejects non-boolean match_confirmed', () => {
    expect(() =>
      VerificationResultSchema.parse({
        match_confirmed: 'yes',
        confidence: 0.5,
        reasoning: '.',
      }),
    ).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() =>
      VerificationResultSchema.parse({ match_confirmed: true, confidence: 0.5 }),
    ).toThrow();
  });
});

describe('VERIFIER_SYSTEM_PROMPT', () => {
  // The trigram + algorithmic matcher already filters obvious mismatches;
  // this prompt's job is the borderline cases. The exact wording is a
  // Rust port — changes here invalidate the prompt-quality comparison
  // against the Rust pinpoint.
  it('matches the Rust verbatim (key clauses)', () => {
    expect(VERIFIER_SYSTEM_PROMPT).toContain('address matching expert');
    expect(VERIFIER_SYSTEM_PROMPT).toContain(
      'Different house numbers almost always mean different locations',
    );
    expect(VERIFIER_SYSTEM_PROMPT).toContain('Respond with structured JSON only.');
  });
});
