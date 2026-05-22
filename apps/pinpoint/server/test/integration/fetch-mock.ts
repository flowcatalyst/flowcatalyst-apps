/**
 * Minimal fetch-mock for integration tests against the libpostal +
 * Photon HTTP services. Both are called via Node's global `fetch`; we
 * replace `globalThis.fetch` with a router that matches by URL prefix
 * and dispatches to registered handlers, falling back to a 404 with
 * a clear message so unhandled calls surface loudly.
 *
 * Why not msw/nock: the harness has exactly two services to mock,
 * each with two endpoints; a 100-line bespoke router beats pulling
 * in another library and threading a setup-file through vitest.
 *
 * Usage in a test file:
 *
 *   const mock = installFetchMock();
 *   afterAll(() => mock.restore());
 *   beforeEach(() => mock.reset());
 *
 *   mock.handle('GET', /\/parse\b/, () => libpostalParseResponse(...));
 *   mock.handle('GET', /\/api\b/, () => photonResponse(...));
 */
type Handler = (
  url: URL,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

interface Registration {
  readonly method: string;
  readonly pattern: RegExp | string;
  readonly handler: Handler;
}

export interface FetchMock {
  /** Register a handler. First match wins. */
  handle(method: string, pattern: RegExp | string, handler: Handler): void;
  /** Drop all registered handlers. Call in beforeEach. */
  reset(): void;
  /** Restore the original `globalThis.fetch`. Call in afterAll. */
  restore(): void;
  /** Spy: list of `${method} ${url}` strings, in call order. */
  readonly calls: readonly string[];
}

function matches(reg: Registration, method: string, urlStr: string): boolean {
  if (reg.method !== method && reg.method !== '*') return false;
  if (typeof reg.pattern === 'string') return urlStr.includes(reg.pattern);
  return reg.pattern.test(urlStr);
}

export function installFetchMock(): FetchMock {
  const original = globalThis.fetch;
  const registrations: Registration[] = [];
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${urlStr}`);
    const url = new URL(urlStr);
    const reg = registrations.find((r) => matches(r, method, urlStr));
    if (!reg) {
      return new Response(`Unmocked fetch: ${method} ${urlStr}`, { status: 404 });
    }
    return reg.handler(url, init);
  }) as typeof fetch;

  return {
    handle(method, pattern, handler) {
      registrations.push({ method: method.toUpperCase(), pattern, handler });
    },
    reset() {
      registrations.length = 0;
      calls.length = 0;
    },
    restore() {
      globalThis.fetch = original;
    },
    get calls() {
      return calls;
    },
  };
}

/** Build a JSON `Response` with the right Content-Type. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
