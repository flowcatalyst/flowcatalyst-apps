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

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    const message =
      (error['error'] as string | undefined) ??
      (error['message'] as string | undefined) ??
      'Request failed';

    if (response.status === 401 || response.status === 403) {
      emitApiError(response.status, message);
    }

    if (response.status !== 401) {
      toast.error('Request Failed', message);
    }

    throw new ApiError(message, response.status, error['code'] as string | undefined);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
