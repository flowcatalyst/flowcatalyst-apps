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
  await reply.code(status).send({
    error: error.type,
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  });
}
