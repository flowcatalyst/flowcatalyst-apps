import type {
  UberCreateDeliveryRequest,
  UberDeliveryResponse,
  UberErrorBody,
  UberQuoteRequest,
  UberQuoteResponse,
} from './types.js';

/**
 * Typed HTTP client for Uber Direct (DaaS). Deliberately NOT the npm
 * `uber-direct` SDK: it is ~20 months stale (0.1.8, Oct 2024), misses the
 * 2025–26 API changes and ships no webhook-signature helper — the surface
 * is 7 endpoints, so we own it (decision with Andrew, 2026-07-11).
 *
 * Auth: OAuth2 client-credentials at auth.uber.com, scope `eats.deliveries`
 * (yes, "eats" — that IS the Direct scope). Tokens live 30 days and the
 * token endpoint is limited to 100 req/hour, so the token is cached and
 * refreshed with a safety margin, never per-request.
 */
export interface UberClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** `cus_…` (or UUID) from the Direct dashboard Developer tab. Test vs
   *  production is SEPARATE CREDENTIALS on the same URLs (live_mode flags
   *  the environment on every response/webhook) — there is no sandbox host. */
  readonly customerId: string;
  readonly baseUrl?: string;
  readonly authUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.uber.com/v1';
const DEFAULT_AUTH_URL = 'https://auth.uber.com/oauth/v2/token';
/** Refresh when less than a day of the 30-day token remains. */
const TOKEN_REFRESH_MARGIN_MS = 24 * 3600 * 1000;

export class UberApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly metadata?: Record<string, unknown>,
  ) {
    super(`uber ${status} ${code}: ${message}`);
    this.name = 'UberApiError';
  }
}

export interface UberClient {
  createQuote(request: UberQuoteRequest): Promise<UberQuoteResponse>;
  createDelivery(request: UberCreateDeliveryRequest): Promise<UberDeliveryResponse>;
  getDelivery(deliveryId: string): Promise<UberDeliveryResponse>;
  cancelDelivery(deliveryId: string): Promise<UberDeliveryResponse>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createUberClient(
  config: UberClientConfig,
  fetchImpl: FetchLike = fetch,
): UberClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const authUrl = config.authUrl ?? DEFAULT_AUTH_URL;
  let token: { value: string; expiresAt: number } | null = null;

  async function getToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return token.value;
    const res = await fetchImpl(authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'client_credentials',
        scope: 'eats.deliveries',
      }).toString(),
    });
    if (!res.ok) {
      throw new UberApiError(res.status, 'auth_failed', await res.text().catch(() => ''));
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const doCall = async (bearer: string): Promise<Response> =>
      fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    let res = await doCall(await getToken());
    if (res.status === 401) {
      token = null; // revoked / rotated — one forced refresh, then fail loudly
      res = await doCall(await getToken());
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as UberErrorBody | null;
      throw new UberApiError(
        res.status,
        err?.code ?? 'unknown_error',
        err?.message ?? res.statusText,
        err?.metadata,
      );
    }
    return (await res.json()) as T;
  }

  const customer = `/customers/${config.customerId}`;
  return {
    createQuote: (request) => call('POST', `${customer}/delivery_quotes`, request),
    createDelivery: (request) => call('POST', `${customer}/deliveries`, request),
    getDelivery: (deliveryId) => call('GET', `${customer}/deliveries/${deliveryId}`),
    cancelDelivery: (deliveryId) => call('POST', `${customer}/deliveries/${deliveryId}/cancel`),
  };
}
