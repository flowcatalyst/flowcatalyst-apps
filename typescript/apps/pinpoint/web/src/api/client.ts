import { toast } from '@flowcatalyst-apps/web-kit';

export const API_BASE_URL = '/bff';

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

/** Per-call knobs for apiFetch that aren't part of the fetch RequestInit. */
export interface ApiFetchConfig {
  /**
   * Skip the generic "Request Failed" toast on error. Pass this when the caller
   * shows its own contextual toast (e.g. `toast.error('Geocoding failed', …)`),
   * so the two don't stack into a duplicate. 401/403 handling still runs.
   */
  suppressErrorToast?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  config: ApiFetchConfig = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: 'Request failed' }))) as Record<
      string,
      unknown
    >;
    // Prefer the human-readable `message`; fall back to the machine `error`
    // type only when there's no message. (Server errors carry both:
    // `{ error: 'authorization', message: 'Missing permission …' }`.)
    const message =
      (error['message'] as string | undefined) ??
      (error['error'] as string | undefined) ??
      'Request failed';
    const code = error['code'] as string | undefined;

    emitApiError(response.status, message);

    if (response.status === 401) {
      // Session missing or expired — the server already attempted an in-band
      // refresh before returning 401, so re-authentication is required. This
      // is the ONLY status that redirects to login. A 403 is
      // authenticated-but-forbidden (a permission gap, not a session
      // problem) and must NOT redirect, or a user lacking one permission
      // gets bounced through login on a loop.
      window.location.href = '/auth/login';
      throw new ApiError(message, response.status, code);
    }

    // 403 is surfaced by the global PermissionDeniedDialog (it subscribes to
    // emitApiError above), so skip the toast to avoid a double notification.
    // suppressErrorToast lets a caller that renders its own contextual toast
    // opt out of this generic one (same anti-duplication reason).
    if (response.status !== 403 && !config.suppressErrorToast) {
      toast.error('Request Failed', message);
    }
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
