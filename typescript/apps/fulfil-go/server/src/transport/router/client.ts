/**
 * Typed client for the Inhance ROUTER service (VROOM/OSRM/Valhalla —
 * https://router.inhanceapps.com/reference/docs). The planning context's
 * optimization engine: multi-stop sequencing (`solve`), companion detour
 * ranking (`distanceMatrix`), and simple A→B legs (`simpleRoute`).
 *
 * Auth: FlowCatalyst SERVICE TOKEN (client-credentials at the PLATFORM's
 * /oauth/token — production router auths against production platform; the
 * token needs the `router:executor` scope). Same cached-token pattern as
 * the EPOD client. Errors carry the router's normalized error kinds
 * (busy/validation/not_found/upstream_failure/upstream_timeout).
 */

export interface RouterClientConfig {
  /** e.g. https://router.inhanceapps.com (no trailing slash). */
  readonly baseUrl: string;
  /** FlowCatalyst platform base URL — the token endpoint host. */
  readonly platformUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

export class RouterApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(`router ${status} ${kind}: ${message}`);
    this.name = 'RouterApiError';
  }
}

export interface Lonlat {
  readonly lon: number;
  readonly lat: number;
}

export interface DistanceMatrixRequest {
  readonly provider: 'osrm' | 'valhalla';
  readonly sources: readonly Lonlat[];
  readonly targets: readonly Lonlat[];
  readonly metrics: readonly ('distance' | 'duration')[];
  /** Valhalla only — traffic-aware departure. */
  readonly departureTime?: string;
}

export interface DistanceMatrixResponse {
  readonly provider: string;
  readonly units: { distance?: string; duration?: string };
  readonly distances?: readonly (readonly number[])[];
  readonly durations?: readonly (readonly number[])[];
}

export interface SimpleRouteResponse {
  readonly provider: string;
  readonly distance: number;
  readonly duration: number;
  readonly waypoints: readonly (readonly [number, number])[];
}

/** VROOM problem shapes — [lon, lat] coordinate convention. */
export interface VroomVehicle {
  readonly id: number;
  readonly start?: readonly [number, number];
  readonly end?: readonly [number, number];
  readonly capacity?: readonly number[];
  readonly profile?: string;
}

export interface VroomJob {
  readonly id: number;
  readonly location: readonly [number, number];
  readonly service?: number;
  readonly delivery?: readonly number[];
  readonly time_windows?: readonly (readonly [number, number])[];
}

export interface SolveRequest {
  readonly vehicles: readonly VroomVehicle[];
  readonly jobs: readonly VroomJob[];
  readonly excludeLayers?: readonly string[];
  readonly costing?: string;
}

export interface SolveResponse {
  readonly solve: {
    readonly code: number;
    readonly summary: { readonly cost: number; readonly unassigned: number };
    readonly routes: readonly {
      readonly vehicle: number;
      readonly cost?: number;
      readonly duration?: number;
      readonly distance?: number;
      readonly steps: readonly {
        readonly type: string;
        readonly id?: number;
        readonly location?: readonly [number, number];
        readonly arrival?: number;
      }[];
    }[];
    readonly unassigned?: readonly { readonly id: number }[];
  };
  readonly solveId?: string;
}

export interface RouterClient {
  simpleRoute(from: Lonlat, to: Lonlat): Promise<SimpleRouteResponse>;
  distanceMatrix(request: DistanceMatrixRequest): Promise<DistanceMatrixResponse>;
  /** Exclusion-aware VROOM solve (Valhalla-computed matrix). */
  solve(request: SolveRequest): Promise<SolveResponse>;
  health(): Promise<boolean>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createRouterClient(
  config: RouterClientConfig,
  fetchImpl: FetchLike = fetch,
): RouterClient {
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
      throw new RouterApiError(
        res.status,
        'auth',
        `FlowCatalyst token request failed: ${await res.text().catch(() => '')}`,
      );
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const doFetch = async (): Promise<Response> =>
      fetchImpl(`${config.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${await getToken()}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });

    let res = await doFetch();
    if (res.status === 401) {
      // Rotated/revoked mid-flight — ONE forced refresh, then fail loudly.
      token = null;
      res = await doFetch();
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { kind?: string; message?: string };
      } | null;
      throw new RouterApiError(
        res.status,
        body?.error?.kind ?? 'unknown',
        body?.error?.message ?? `router request failed (${res.status})`,
        body,
      );
    }
    return (await res.json()) as T;
  }

  return {
    simpleRoute: (from, to) =>
      call<SimpleRouteResponse>('/v1/route/simple', { method: 'POST', body: { from, to } }),
    distanceMatrix: (request) =>
      call<DistanceMatrixResponse>('/v1/distance-matrix', { method: 'POST', body: request }),
    solve: (request) => call<SolveResponse>('/v1/solve', { method: 'POST', body: request }),
    async health(): Promise<boolean> {
      try {
        const res = await fetchImpl(`${config.baseUrl}/health`);
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
