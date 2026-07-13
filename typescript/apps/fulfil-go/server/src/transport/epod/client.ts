import type {
  EpodLocationUpsert,
  EpodProductUpsert,
  EpodRoutePlan,
  EpodRoutePlanResponse,
  EpodUpsertResponse,
} from './types.js';

/**
 * Typed HTTP client for the EPOD (Integral TMS) fulfil-go endpoints —
 * mirrors the Uber client shape (own the 3-endpoint surface, no SDK).
 *
 * Auth: FlowCatalyst SERVICE TOKEN via client-credentials against the
 * platform's `/oauth/token` — their side validates it with the existing
 * `fc.or-passport` middleware (FC token audience contract: aud == iss ==
 * platform base URL, NOT client_id). Tenant selection rides the
 * `X-INHANCE-TENANT` header (our client code == their tenant code).
 *
 * Tokens are cached and refreshed with a safety margin; a 401 mid-flight
 * (rotated/revoked) forces ONE refresh, then fails loudly.
 */
export interface EpodClientConfig {
  /** EPOD/Integral host, e.g. `https://<tenant-domain>` (no trailing slash). */
  readonly baseUrl: string;
  /** `X-INHANCE-TENANT` value — our client code == their tenant code. */
  readonly tenantCode: string;
  /** FlowCatalyst platform base URL (token endpoint host). */
  readonly platformUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Refresh when less than a minute of the token's lifetime remains. */
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

export class EpodApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(`epod ${status}: ${message}`);
    this.name = 'EpodApiError';
  }
}

export interface EpodClient {
  upsertLocations(locations: readonly EpodLocationUpsert[]): Promise<EpodUpsertResponse>;
  upsertProducts(products: readonly EpodProductUpsert[]): Promise<EpodUpsertResponse>;
  /**
   * Synchronous route-plan push — the future claim flow's booking signal
   * (explicit accept/reject; see docs/transport-context.md "EPOD integration
   * plan"). Provisioning never calls this; typed loosely until the planning
   * context lands.
   */
  sendRoutePlan(plan: EpodRoutePlan): Promise<EpodRoutePlanResponse>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createEpodClient(
  config: EpodClientConfig,
  fetchImpl: FetchLike = fetch,
): EpodClient {
  const apiBase = `${config.baseUrl}/api/v1/tms/epod/fulfilgo`;
  const tokenUrl = `${config.platformUrl}/oauth/token`;
  let token: { value: string; expiresAt: number } | null = null;

  async function getToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return token.value;
    const res = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      throw new EpodApiError(
        res.status,
        `FlowCatalyst token request failed: ${await res.text().catch(() => '')}`,
      );
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const doCall = async (bearer: string): Promise<Response> =>
      fetchImpl(`${apiBase}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          'x-inhance-tenant': config.tenantCode,
        },
        body: JSON.stringify(body),
      });

    let res = await doCall(await getToken());
    if (res.status === 401) {
      token = null; // rotated/revoked — one forced refresh, then fail loudly
      res = await doCall(await getToken());
    }
    if (!res.ok) {
      const errBody: unknown = await res.json().catch(() => null);
      const message =
        (errBody as { message?: string } | null)?.message ??
        (errBody as { error?: string } | null)?.error ??
        res.statusText;
      throw new EpodApiError(res.status, message, errBody);
    }
    return (await res.json()) as T;
  }

  return {
    upsertLocations: (locations) =>
      post<EpodUpsertResponse>('/locations/upsert', { locations: [...locations] }),
    upsertProducts: (products) =>
      post<EpodUpsertResponse>('/products/upsert', { products: [...products] }),
    sendRoutePlan: (plan) => post<EpodRoutePlanResponse>('/routes/plans', plan),
  };
}
