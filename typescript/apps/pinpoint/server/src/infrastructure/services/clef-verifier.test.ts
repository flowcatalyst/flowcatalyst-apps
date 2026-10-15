/**
 * Clef verifier tests. Mocks `globalThis.fetch` so the tests exercise the real
 * SystemOne client — URL, auth header, request body, response validation — and
 * the per-field verdict → policy mapping, without a model running.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createClefVerifier } from './clef-verifier.js';
import { createSystemOneClient } from './systemone-client.js';

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

type Verdict = 'match' | 'mismatch' | 'missing';

function choice(verdict: Verdict, p = 0.9): unknown {
  const rest = (1 - p) / 2;
  const probabilities = { match: rest, mismatch: rest, missing: rest, [verdict]: p };
  return { type: 'choice', choice: verdict, probabilities, confidence: p };
}

function answers(fields: Record<string, Verdict>, p?: number): unknown {
  return {
    model: 'clef-flash',
    answers: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, choice(v, p)])),
  };
}

const ALL_MATCH = {
  house_number: 'match',
  street: 'match',
  suburb: 'match',
  postal_code: 'match',
  city: 'match',
} as const;

const INPUT = '16 curvy road, blairgowrie, randburg, 2194, za';
const CANDIDATE = '16 curvy rd, blairgowrie, randburg, za';

describe('clef-verifier', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function verifier(
    opts: { apiKey?: string; baseUrl?: string; onError?: (e: unknown) => void } = {},
  ) {
    const client = createSystemOneClient({
      baseUrl: opts.baseUrl ?? 'http://localhost:11434',
      model: 'clef-flash',
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    });
    return createClefVerifier({ client, ...(opts.onError ? { onError: opts.onError } : {}) });
  }

  function sentBody(): { model: string; state: unknown; questions: Record<string, unknown> } {
    return JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body)) as never;
  }

  it('confirms when number, street and a corroborating field match', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(answers({ ...ALL_MATCH, postal_code: 'missing' })));

    const result = await verifier().verify(INPUT, CANDIDATE);

    expect(result?.match_confirmed).toBe(true);
    expect(result?.confidence).toBeCloseTo(0.9, 10);
    expect(result?.reasoning).toBe(
      'clef-flash: house_number=match(0.90) street=match(0.90) suburb=match(0.90) ' +
        'postal_code=missing(0.90) city=match(0.90) → address_corroborated',
    );
  });

  it('rejects when only the city corroborates', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(answers({ ...ALL_MATCH, suburb: 'missing', postal_code: 'missing' })),
    );

    const result = await verifier().verify(
      '12 1st avenue, johannesburg',
      '12 1st ave, melville, johannesburg',
    );

    expect(result?.match_confirmed).toBe(false);
    expect(result?.reasoning).toContain('→ not_corroborated');
  });

  it('asks one choice question per address field, with both addresses in the state', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(answers(ALL_MATCH)));

    await verifier().verify(INPUT, CANDIDATE);

    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:11434/v1/systemone');
    const body = sentBody();
    expect(body.model).toBe('clef-flash');
    expect(body.state).toEqual({ input: { address: INPUT }, candidate: { address: CANDIDATE } });
    expect(Object.keys(body.questions)).toEqual([
      'house_number',
      'street',
      'suburb',
      'postal_code',
      'city',
    ]);
  });

  it('adds a name question when both sides have names, and matches on it', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(answers({ ...ALL_MATCH, street: 'mismatch', name: 'match' })),
    );

    const result = await verifier().verify(INPUT, '12 cradock ave, rosebank, za', {
      inputName: 'Clicks Rosebank',
      candidateNames: ['CLICKS ROSEBANK', '  '],
    });

    const body = sentBody();
    expect(body.state).toEqual({
      input: { address: INPUT, name: 'Clicks Rosebank' },
      candidate: { address: '12 cradock ave, rosebank, za', names: ['CLICKS ROSEBANK'] },
    });
    expect(Object.keys(body.questions)).toContain('name');
    expect(result?.match_confirmed).toBe(true);
    expect(result?.reasoning).toContain('→ name_match');
  });

  it('skips the name question when only one side has a name', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(answers(ALL_MATCH)));

    await verifier().verify(INPUT, CANDIDATE, { inputName: 'Clicks Rosebank', candidateNames: [] });

    expect(Object.keys(sentBody().questions)).not.toContain('name');
  });

  it('sends no auth header to a keyless host (local Ollama)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(answers(ALL_MATCH)));

    await verifier().verify(INPUT, CANDIDATE);

    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBeUndefined();
  });

  it('sends the bearer key and resolves the OpenRouter path', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(answers(ALL_MATCH)));

    await verifier({ baseUrl: 'https://openrouter.ai/api/', apiKey: 'sk-or-test' }).verify(
      INPUT,
      CANDIDATE,
    );

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://openrouter.ai/api/v1/systemone');
    const headers = init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-or-test');
  });

  it('returns null and reports the error on a non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('model not found', { status: 404 }));
    const onError = vi.fn();

    const result = await verifier({ onError }).verify(INPUT, CANDIDATE);

    expect(result).toBeNull();
    expect(String(onError.mock.calls[0]![0])).toContain('returned 404: model not found');
  });

  it('returns null when a field answer is missing', async () => {
    const { city: _city, ...withoutCity } = ALL_MATCH;
    fetchSpy.mockResolvedValueOnce(jsonResponse(answers(withoutCity)));
    const onError = vi.fn();

    const result = await verifier({ onError }).verify(INPUT, CANDIDATE);

    expect(result).toBeNull();
    expect(String(onError.mock.calls[0]![0])).toContain("no answer for 'city'");
  });

  it('returns null when the host is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect(await verifier().verify(INPUT, CANDIDATE)).toBeNull();
  });
});
