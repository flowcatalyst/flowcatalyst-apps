/**
 * The one error envelope every pinpoint route returns (4xx/5xx). Registered
 * once as a Fastify shared schema (`server.addSchema`) so it appears under
 * `components.schemas.ErrorResponse` in the OpenAPI document and every route
 * references it by `$ref` instead of inlining a copy.
 *
 * Producers:
 *  - `sendUseCaseError` → `{ error: <UseCaseErrorType>, code, message, details }`
 *  - route-level guards  → `{ error: 'Unauthorized' | 'NotFound' | 'ValidationError' …, message?, issues? }`
 */
import { Type, type Static } from '@sinclair/typebox';

export const ErrorResponseSchema = Type.Object(
  {
    /** Machine-readable error type (`validation`, `authorization`, `NotFound`, …). */
    error: Type.String(),
    /** Human-readable description — prefer this when presenting to a user. */
    message: Type.Optional(Type.String()),
    /** Stable application error code (use-case failures), e.g. `CLIENT_CODE_EXISTS`. */
    code: Type.Optional(Type.String()),
    /** Free-form structured context for the error (may be null). */
    details: Type.Optional(Type.Unknown()),
    /** Zod validation issues when `error` is `ValidationError`. */
    issues: Type.Optional(Type.Array(Type.Unknown())),
  },
  { $id: 'ErrorResponse', description: 'Standard pinpoint error envelope.' },
);

export type ErrorResponse = Static<typeof ErrorResponseSchema>;

/**
 * `$ref` to the shared schema for use in route `response` maps:
 *
 *   response: { 200: OkSchema, 400: ErrorResponseRef, 401: ErrorResponseRef }
 *
 * Typed as `ErrorResponse` so `reply.code(4xx).send({...})` stays checked.
 */
export const ErrorResponseRef = Type.Unsafe<ErrorResponse>(Type.Ref('ErrorResponse#'));
