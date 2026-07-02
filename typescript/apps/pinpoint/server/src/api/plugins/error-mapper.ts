import type { FastifyReply } from 'fastify';
import { UseCaseError, type UseCaseError as UseCaseErrorType } from '@pinpoint/framework';

/**
 * Map a `UseCaseError` to an HTTP response with the conventional shape.
 * The SDK's `UseCaseError` is a discriminated union with a `type` field —
 * we surface it as `error` in the response body so the wire shape stays
 * stable.
 */
export async function sendUseCaseError(
  reply: FastifyReply,
  error: UseCaseErrorType,
): Promise<void> {
  const status = UseCaseError.httpStatus(error);
  // 5xx are handled-but-returned (not thrown), so Fastify's own error logging
  // never fires — a bare `statusCode: 500` with no detail lands in the logs.
  // Log the mapped error here so infrastructure failures (GEOCODER_FAILED, DB
  // errors, …) surface their code + message + details. 4xx are client faults;
  // leave them out of the error log to avoid noise.
  if (status >= 500) {
    reply.log.error(
      { err: { type: error.type, code: error.code, message: error.message, details: error.details } },
      `use-case error → ${status}: ${error.code} ${error.message}`,
    );
  }
  await reply.code(status).send({
    error: error.type,
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  });
}
