import type { FastifyReply } from 'fastify';
import { httpStatus, type UseCaseError } from '@pinpoint/framework';
import {
  UseCaseError as PlainUseCaseError,
  type UseCaseError as PlainUseCaseErrorType,
} from '@pinpoint/framework/plain';

export async function sendUseCaseError(reply: FastifyReply, error: UseCaseError): Promise<void> {
  const status = httpStatus(error);
  await reply.code(status).send({
    error: error._tag,
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  });
}

export async function sendPlainUseCaseError(
  reply: FastifyReply,
  error: PlainUseCaseErrorType,
): Promise<void> {
  const status = PlainUseCaseError.httpStatus(error);
  await reply.code(status).send({
    error: error.type,
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  });
}
