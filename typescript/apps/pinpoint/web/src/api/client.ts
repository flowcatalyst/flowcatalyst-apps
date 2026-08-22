/**
 * HTTP client for the pinpoint BFF.
 *
 * `api` is the typed client: openapi-fetch over `schema.gen.d.ts`, which is
 * generated from `apps/pinpoint/openapi.gen.json` by `pnpm api:types`. Paths,
 * params, bodies and responses are checked against the server's TypeBox route
 * schemas. If an endpoint you need isn't on `api`, add it to the server (and
 * regenerate) — there is deliberately no untyped escape hatch.
 *
 * Error policy lives in the middleware: emit on the error bus (drives the
 * PermissionDenied dialog), redirect on 401, toast on everything else unless
 * the caller opted out, then throw `ApiError`.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import { toast } from '@flowcatalyst-apps/web-kit';
import type { paths } from './schema.gen';

export type ApiPaths = paths;

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type ApiErrorListener = (status: number, message: string) => void;
const errorListeners: ApiErrorListener[] = [];

export function onApiError(listener: ApiErrorListener): () => void {
  errorListeners.push(listener);
  return () => {
    const index = errorListeners.indexOf(listener);
    if (index > -1) {
      errorListeners.splice(index, 1);
    }
  };
}

function emitApiError(status: number, message: string) {
  errorListeners.forEach((listener) => listener(status, message));
}

/**
 * Trigger the global "Access Denied" modal from non-HTTP contexts (e.g. a
 * router guard blocking navigation to a page the user lacks permission for).
 * Reuses the same 403 bus the api client emits on.
 */
export function notifyPermissionDenied(
  message = 'You do not have permission to access that page.',
): void {
  emitApiError(403, message);
}

/** Per-call error-handling knobs (see `suppressErrorToast`). */
interface ApiFetchConfig {
  /**
   * Skip the generic "Request Failed" toast on error. Pass this when the caller
   * shows its own contextual toast (e.g. `toast.error('Geocoding failed', …)`),
   * so the two don't stack into a duplicate. 401/403 handling still runs.
   */
  suppressErrorToast?: boolean;
}

/**
 * Shared non-2xx handling. Returns the `ApiError` for the caller to throw.
 * Server errors carry both a machine `error` and a human `message`
 * (`{ error: 'authorization', message: 'Missing permission …' }`); prefer
 * the message.
 */
function handleErrorResponse(
  status: number,
  body: Record<string, unknown>,
  config: ApiFetchConfig,
): ApiError {
  const message =
    (body['message'] as string | undefined) ??
    (body['error'] as string | undefined) ??
    'Request failed';
  const code = body['code'] as string | undefined;

  emitApiError(status, message);

  if (status === 401) {
    // Session missing or expired — the server already attempted an in-band
    // refresh before returning 401, so re-authentication is required. This
    // is the ONLY status that redirects to login. A 403 is
    // authenticated-but-forbidden (a permission gap, not a session
    // problem) and must NOT redirect, or a user lacking one permission
    // gets bounced through login on a loop.
    window.location.href = '/auth/login';
    return new ApiError(message, status, code);
  }

  // 403 is surfaced by the global PermissionDeniedDialog (it subscribes to
  // emitApiError above), so skip the toast to avoid a double notification.
  // suppressErrorToast lets a caller that renders its own contextual toast
  // opt out of this generic one (same anti-duplication reason).
  if (status !== 403 && !config.suppressErrorToast) {
    toast.error('Request Failed', message);
  }
  return new ApiError(message, status, code);
}

// ── Typed client ─────────────────────────────────────────────────────────────

/**
 * Marker header a caller adds to opt out of the generic error toast. It is
 * consumed by the middleware and stripped before the request leaves the
 * browser — the server never sees it.
 */
const SUPPRESS_TOAST_HEADER = 'x-pinpoint-suppress-error-toast';

/**
 * Spread into a typed call's init to skip the generic error toast:
 *
 *   await api.DELETE('/bff/clients/{clientId}/layers/{layerId}', {
 *     params: { path: { clientId, layerId } },
 *     ...suppressErrorToast,
 *   });
 */
export const suppressErrorToast = { headers: { [SUPPRESS_TOAST_HEADER]: '1' } } as const;

const suppressedRequestIds = new Set<string>();

const errorHandling: Middleware = {
  onRequest({ request, id }) {
    if (request.headers.has(SUPPRESS_TOAST_HEADER)) {
      request.headers.delete(SUPPRESS_TOAST_HEADER);
      suppressedRequestIds.add(id);
    }
  },
  async onResponse({ response, id }) {
    const suppress = suppressedRequestIds.delete(id);
    if (response.ok) return;
    const body = (await response
      .clone()
      .json()
      .catch(() => ({ error: 'Request failed' }))) as Record<string, unknown>;
    // Throwing from middleware rejects the `api.X()` promise — callers see
    // the same ApiError they got from apiFetch.
    throw handleErrorResponse(response.status, body, { suppressErrorToast: suppress });
  },
  onError({ id }) {
    suppressedRequestIds.delete(id);
  },
};

/**
 * Typed BFF client. Paths are the full spec paths (they include `/bff`), so
 * `baseUrl` is empty and requests stay same-origin (vite proxies `/bff` and
 * `/auth` in dev; the server serves both in prod).
 */
export const api = createClient<paths>({ baseUrl: '', credentials: 'include' });
api.use(errorHandling);

/**
 * Unwrap a typed call to its response body. The error middleware throws on
 * non-2xx, so a resolved call always carries data (it is only `undefined`
 * for 204, which no caller reads).
 *
 *   const { items } = await ok(api.GET('/bff/clients/{clientId}/layers', {
 *     params: { path: { clientId } },
 *   }));
 */
export async function ok<T extends { data?: unknown }>(
  call: Promise<T>,
): Promise<NonNullable<T['data']>> {
  const { data } = await call;
  return data as NonNullable<T['data']>;
}

type JsonOf<R> = R extends { content: { 'application/json': infer B } } ? B : never;

/**
 * The 200/201 JSON response body of an operation — use it to name row/detail
 * types in pages instead of hand-writing interfaces:
 *
 *   type Layer = ApiResponse<'/bff/clients/{clientId}/layers', 'get'>['items'][number];
 */
export type ApiResponse<P extends keyof paths, M extends keyof paths[P]> =
  paths[P][M] extends { responses: infer R }
    ? R extends { 200: infer S }
      ? JsonOf<S>
      : R extends { 201: infer S }
        ? JsonOf<S>
        : never
    : never;

/** The JSON request body of an operation (for typing form payloads). */
export type ApiRequestBody<P extends keyof paths, M extends keyof paths[P]> =
  paths[P][M] extends { requestBody?: infer RB }
    ? RB extends { content: { 'application/json': infer B } }
      ? B
      : never
    : never;
