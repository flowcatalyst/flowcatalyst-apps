/**
 * Ollama verifier tests. Mocks `globalThis.fetch` so the tests exercise
 * the same code path that runs against a real Ollama instance — request
 * body shape (model + messages + structured `format` field), response
 * parsing, error → null fallback — without needing the daemon up.
 *
 * Rust pattern preservation: the verifier swallows errors and returns
 * `null` rather than throwing. The matching pipeline (Slice 8) will
 * fall back to the algorithmic verdict when verification is unavailable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { VERIFIER_SYSTEM_PROMPT } from '../../domain/services/address-verifier.js';
import { createOllamaVerifier } from './ollama-verifier.js';

const BASE_URL = 'http://localhost:11434';
const MODEL = 'gemma3';

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

function chatBody(content: string): unknown {
  return {
    model: MODEL,
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content },
    done: true,
  };
}

describe('ollama-verifier', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns the parsed verdict on a happy-path response', async () => {
    const verdict = {
      match_confirmed: true,
      confidence: 0.92,
      reasoning: 'Same house number on the same street in the same city — clearly the same place.',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(chatBody(JSON.stringify(verdict))));

    const verifier = createOllamaVerifier({ baseUrl: BASE_URL, model: MODEL });
    const result = await verifier.verify(
      '548 Market St, San Francisco, US',
      '548 Market Street, San Francisco, United States',
    );

    expect(result).toEqual(verdict);
  });

  it('posts to /api/chat with system + user messages + a structured format field', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        chatBody(JSON.stringify({ match_confirmed: false, confidence: 0.1, reasoning: 'no' })),
      ),
    );

    const verifier = createOllamaVerifier({ baseUrl: BASE_URL, model: MODEL });
    await verifier.verify('a', 'b');

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE_URL}/api/chat`);

    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as {
      model: string;
      stream: boolean;
      format: { type: string; required: string[] };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe(MODEL);
    expect(body.stream).toBe(false);
    // Schema constraint forwarded to Ollama — the model is asked to emit
    // an object with these three keys. The verifier still validates the
    // response on the way back; the schema is defence-in-depth.
    expect(body.format.type).toBe('object');
    expect(body.format.required).toEqual(['match_confirmed', 'confidence', 'reasoning']);

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: VERIFIER_SYSTEM_PROMPT });
    expect(body.messages[1]?.role).toBe('user');
    expect(body.messages[1]?.content).toContain('Input address: "a"');
    expect(body.messages[1]?.content).toContain('Candidate address: "b"');
  });

  it('strips trailing slashes from the configured base URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        chatBody(JSON.stringify({ match_confirmed: true, confidence: 1, reasoning: '.' })),
      ),
    );

    const verifier = createOllamaVerifier({ baseUrl: `${BASE_URL}/`, model: MODEL });
    await verifier.verify('a', 'b');

    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`${BASE_URL}/api/chat`);
  });

  it('returns null + invokes onError when Ollama returns non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(textResponse('model loading', 503));
    const onError = vi.fn();

    const verifier = createOllamaVerifier({ baseUrl: BASE_URL, model: MODEL, onError });
    const result = await verifier.verify('a', 'b');

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    const [err] = onError.mock.calls[0]!;
    expect((err as Error).message).toContain('Ollama /api/chat returned 503');
  });

  it('returns null when the response content is not valid JSON', async () => {
    // Even with `format` set Ollama can still return prose if the model
    // truly misbehaves — the response parser is the last line of defence.
    fetchSpy.mockResolvedValueOnce(jsonResponse(chatBody('not json at all')));
    const onError = vi.fn();

    const verifier = createOllamaVerifier({ baseUrl: BASE_URL, model: MODEL, onError });
    const result = await verifier.verify('a', 'b');

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('returns null when the response content is JSON but fails schema validation', async () => {
    // Right-shape-wrong-types — confidence is supposed to be 0..1.
    const malformed = { match_confirmed: 'yes', confidence: 1.5, reasoning: 7 };
    fetchSpy.mockResolvedValueOnce(jsonResponse(chatBody(JSON.stringify(malformed))));
    const onError = vi.fn();

    const verifier = createOllamaVerifier({ baseUrl: BASE_URL, model: MODEL, onError });
    const result = await verifier.verify('a', 'b');

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('returns null when the fetch itself rejects (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const onError = vi.fn();

    const verifier = createOllamaVerifier({ baseUrl: BASE_URL, model: MODEL, onError });
    const result = await verifier.verify('a', 'b');

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });
});
