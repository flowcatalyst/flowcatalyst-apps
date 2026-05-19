import type { FastifyReply } from 'fastify';
import { httpStatus, type UseCaseError } from '@pinpoint/framework';

/**
 * Map a `UseCaseError` to an HTTP response with the conventional shape.
 * Mirrors @fulfil/server's `sendUseCaseError`.
 */
export async function sendUseCaseError(reply: FastifyReply, error: UseCaseError): Promise<void> {
  const status = httpStatus(error);
  await reply.code(status).send({
    error: error._tag,
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  });
}
