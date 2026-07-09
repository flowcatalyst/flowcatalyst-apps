import type { FastifyReply } from 'fastify';
import { UseCaseError, type UseCaseError as UseCaseErrorType } from '@fulfil-go/framework';

interface MappedError {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}

/**
 * Map a `UseCaseError` to its wire shape.
 *
 * Special case: the SDK's UnitOfWork catches everything thrown by the
 * persist callback and wraps it as infrastructure/COMMIT_FAILED — including
 * our `ConcurrencyConflictError` from the optimistic-lock guard. Unwrap that
 * back to a 409 concurrency error here so callers see a retryable conflict,
 * not a 500. (Cleaner fix — the SDK preserving tagged errors — is flagged
 * upstream.)
 */
function mapUseCaseError(error: UseCaseErrorType): MappedError {
  const cause = String(
    (error.details as { cause?: unknown } | null | undefined)?.cause ?? error.message,
  );
  if (error.code === 'COMMIT_FAILED' && cause.includes('was modified concurrently')) {
    return {
      status: 409,
      type: 'concurrency',
      code: 'CONCURRENT_MODIFICATION',
      message: cause,
      details: null,
    };
  }
  return {
    status: UseCaseError.httpStatus(error),
    type: error.type,
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  };
}

/**
 * Same mapping as sendUseCaseError but returning a `{status, body}` outcome
 * instead of writing the reply — for handlers wrapped in withIdempotency,
 * which owns the reply so it can store/replay the response.
 */
export function useCaseErrorOutcome(error: UseCaseErrorType): {
  status: number;
  body: unknown;
} {
  const mapped = mapUseCaseError(error);
  return {
    status: mapped.status,
    body: {
      error: mapped.type,
      code: mapped.code,
      message: mapped.message,
      details: mapped.details,
    },
  };
}

/**
 * Map a `UseCaseError` to an HTTP response with the conventional shape.
 * 5xx are handled-but-returned (not thrown), so Fastify's own error logging
 * never fires — log the mapped error here so infrastructure failures
 * surface their code + message + details. 4xx are client faults; leave
 * them out of the error log to avoid noise.
 */
export async function sendUseCaseError(
  reply: FastifyReply,
  error: UseCaseErrorType,
): Promise<void> {
  const mapped = mapUseCaseError(error);
  if (mapped.status >= 500) {
    reply.log.error(
      {
        err: {
          type: mapped.type,
          code: mapped.code,
          message: mapped.message,
          details: mapped.details,
        },
      },
      `use-case error → ${mapped.status}: ${mapped.code} ${mapped.message}`,
    );
  }
  await reply.code(mapped.status).send({
    error: mapped.type,
    code: mapped.code,
    message: mapped.message,
    details: mapped.details,
  });
}
