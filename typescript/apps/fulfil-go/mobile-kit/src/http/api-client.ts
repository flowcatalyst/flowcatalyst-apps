/**
 * Thin fetch wrapper shared by pages, the SSE client and the offline queue:
 * base-URL joining, bearer injection, one refresh-and-retry on 401.
 *
 * Browser dev mode: pass `devUserId` to authenticate via the server's
 * `x-user-id` dev fallback (FULFILGO_AUTH_DEV_FALLBACK=true) instead of a
 * bearer token — no IdP needed on a laptop.
 */
export interface TokenProvider {
  /** Current access token, refreshing first if it's about to expire. Null = signed out. */
  getAccessToken(): Promise<string | null>;
  /** Force a refresh-token exchange. False = refresh failed (signed out). */
  refresh(): Promise<boolean>;
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly tokens?: TokenProvider;
  /**
   * Browser-dev fallback principal (sent as x-user-id). When `tokens` is
   * also provided, a bearer wins while SIGNED IN — the dev headers only
   * cover the signed-out state (dev servers with the fallback enabled).
   */
  readonly devUserId?: string;
  /** Display name for the dev-fallback principal (sent as x-user-name). */
  readonly devUserName?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ApiRequestInit {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export interface ApiClient {
  readonly baseUrl: string;
  /** Auth headers for callers that manage their own connection (SSE). */
  authHeaders(): Promise<Record<string, string>>;
  request(path: string, init?: ApiRequestInit): Promise<Response>;
  json<T>(path: string, init?: ApiRequestInit): Promise<T>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function authHeaders(): Promise<Record<string, string>> {
    if (options.tokens) {
      const token = await options.tokens.getAccessToken();
      if (token) return { authorization: `Bearer ${token}` };
      // Signed out — fall through to the dev fallback when configured.
    }
    if (options.devUserId) {
      return {
        'x-user-id': options.devUserId,
        ...(options.devUserName ? { 'x-user-name': options.devUserName } : {}),
      };
    }
    return {};
  }

  async function doFetch(path: string, init: ApiRequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(await authHeaders()),
      ...init.headers,
    };
    return fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  }

  async function request(path: string, init: ApiRequestInit = {}): Promise<Response> {
    const res = await doFetch(path, init);
    if (res.status === 401 && options.tokens) {
      const refreshed = await options.tokens.refresh();
      if (refreshed) return doFetch(path, init);
    }
    return res;
  }

  return {
    baseUrl,
    authHeaders,
    request,
    async json<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
      const res = await request(path, init);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`API ${init.method ?? 'GET'} ${path} failed (${res.status}): ${detail}`);
      }
      return (await res.json()) as T;
    },
  };
}
