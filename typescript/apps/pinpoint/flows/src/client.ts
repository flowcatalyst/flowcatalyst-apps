import createClient from 'openapi-fetch';
import type { paths } from './schema.gen.js';

export type Api = ReturnType<typeof createClient<paths>>;

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

/** Typed client against the pinpoint server, authenticating with the dev `x-user-id` identity. */
export function makeApi(baseUrl: string, principal: string): Api {
  return createClient<paths>({ baseUrl, headers: { 'x-user-id': principal } });
}

/** Unwrap an openapi-fetch result; throws ApiCallError with the server's error envelope on non-2xx. */
export async function ok<T extends { data?: unknown; error?: unknown; response: Response }>(
  call: Promise<T>,
): Promise<NonNullable<T['data']>> {
  const r = await call;
  if (!r.response.ok) {
    const body = r.error as { error?: string; message?: string; code?: string } | undefined;
    throw new ApiCallError(
      r.response.status,
      r.error,
      `${r.response.status} ${body?.error ?? ''}${body?.code ? ` [${body.code}]` : ''}${body?.message ? `: ${body.message}` : ''}`,
    );
  }
  return r.data as NonNullable<T['data']>;
}
