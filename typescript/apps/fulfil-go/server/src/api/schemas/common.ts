import { Type } from '@sinclair/typebox';

/** Wire shape produced by sendUseCaseError — declare on every route that can fail. */
export const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  code: Type.String(),
  message: Type.String(),
  details: Type.Union([Type.Null(), Type.Any()]),
});

export const ValidationIssuesSchema = Type.Object({
  error: Type.Literal('ValidationError'),
  issues: Type.Array(Type.Any()),
});

export const UnauthorizedSchema = Type.Object({
  error: Type.Literal('Unauthorized'),
  message: Type.String(),
});

/**
 * 400s come in two shapes: Zod parse issues from the route boundary, and
 * use-case `validation` failures via sendUseCaseError. Declaring only one
 * makes Fastify fail to serialize the other (FST_ERR_FAILED_ERROR_SERIALIZATION).
 */
export const BadRequestSchema = Type.Union([ValidationIssuesSchema, ErrorResponseSchema]);

/** Standard response set for command routes. */
export const WRITE_RESPONSES = {
  400: BadRequestSchema,
  401: UnauthorizedSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  422: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;
