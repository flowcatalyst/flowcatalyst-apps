/**
 * Clef verifier tests. Mocks `globalThis.fetch` so the tests exercise the real
 * SystemOne client — URL, auth header, request body, response validation — and
 * the verdict mapping, without a model running.
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

function noulAnswer(p: number): unknown {
  return {
    model: 'clef-flash',
    answers: { same_location: { type: 'noul', noul: p } },
    usage: { input_tokens: 180, output_tokens: 1 },
  };
}

const INPUT = '16 curvy road, blairgowrie, randburg, za';
const CANDIDATE = '16 curvy rd, randburg, za';

describe('clef-verifier', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function verifier(opts: { apiKey?: string; baseUrl?: string; onError?: (e: unknown) => void } = {}) {
    const client = createSystemOneClient({
      baseUrl: opts.baseUrl ?? 'http://localhost:11434',
      model: 'clef-flash',
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    });
    return createClefVerifier({ client, ...(opts.onError ? { onError: opts.onError } : {}) });
  }

  it('confirms the match when P(same location) clears the threshold', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(noulAnswer(0.93)));

    const result = await verifier().verify(INPUT, CANDIDATE);

    expect(result).toEqual({
      match_confirmed: true,
      confidence: 0.93,
      reasoning: 'clef-flash: P(same location) = 0.930',
    });
  });

  it('rejects the match below the threshold, with confidence in the rejection', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(noulAnswer(0.1)));

    const result = await verifier().verify(INPUT, '18 curvy road, randburg, za');

    expect(result?.match_confirmed).toBe(false);
    expect(result?.confidence).toBeCloseTo(0.9, 10);
  });

  it('posts a SystemOne noul question with both addresses in the state', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(noulAnswer(0.5)));

    await verifier().verify(INPUT, CANDIDATE);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:11434/v1/systemone');
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      state: unknown;
      questions: Record<string, { type: string; instructions: string }>;
    };
    expect(body.model).toBe('clef-flash');
    expect(body.state).toEqual({ input_address: INPUT, candidate_address: CANDIDATE });
    expect(body.questions['same_location']?.type).toBe('noul');
    // The verifier's matching rules travel with the question.
    expect(body.questions['same_location']?.instructions).toContain(
      'Different house numbers almost always mean different locations',
    );
  });

  it('sends no auth header to a keyless host (local Ollama)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(noulAnswer(0.5)));

    await verifier().verify(INPUT, CANDIDATE);

    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBeUndefined();
  });

  it('sends the bearer key and resolves the OpenRouter path', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(noulAnswer(0.5)));

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

  it('returns null when the answer is missing or malformed', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ answers: {} }));
    const onError = vi.fn();

    const result = await verifier({ onError }).verify(INPUT, CANDIDATE);

    expect(result).toBeNull();
    expect(String(onError.mock.calls[0]![0])).toContain("no answer for 'same_location'");
  });

  it('returns null when the host is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect(await verifier().verify(INPUT, CANDIDATE)).toBeNull();
  });
});
