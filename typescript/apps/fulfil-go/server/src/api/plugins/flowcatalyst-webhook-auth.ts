/**
 * FlowCatalyst inbound-webhook HMAC verification.
 *
 * Delegates to the SDK's `verifyDeliverySignature` (v0.9.7+) — the canonical
 * verifier for scheduled-job firings and dispatch webhooks:
 *   message       = `${timestamp}${rawBody}`
 *   signature     = hmac_sha256(message, secret), hex-encoded
 *   headers       = X-FlowCatalyst-Signature, X-FlowCatalyst-Timestamp
 *   timestamp     = ms-precision ISO8601 (platform default) OR bare Unix
 *                   seconds (legacy) — the HMAC covers the raw header string
 *                   either way
 *   tolerance     = 300s past, 60s future (replay protection)
 *   comparison    = constant-time
 *
 * Plugged onto the reactor route plugin via `flowcatalystWebhookAuthHook` so
 * every `/reactors/*` request is verified before the route handler runs.
 *
 * Dev mode: when no signing secret is configured, the hook logs a one-time
 * warning per request and skips verification — so local dev + tests don't
 * need a secret. NEVER deploy without setting `FLOWCATALYST_SIGNING_SECRET`.
 */

import {
  verifyDeliverySignature,
  WebhookSignatureError,
  type WebhookSignatureErrorCode,
} from '@flowcatalyst/sdk';
import type { FastifyReply, FastifyRequest } from 'fastify';

// Augment FastifyRequest to expose the raw body string captured by the
// content-type parser registered in server.ts.
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export const FC_SIGNATURE_HEADER = 'x-flowcatalyst-signature';
export const FC_TIMESTAMP_HEADER = 'x-flowcatalyst-timestamp';

export interface VerifyOptions {
  /** Max age of the signed timestamp in seconds. Default 300 (5 min). */
  readonly toleranceSeconds?: number;
}

export type VerifyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'MISSING_SIGNATURE'
        | 'MISSING_TIMESTAMP'
        | 'TIMESTAMP_INVALID'
        | 'TIMESTAMP_EXPIRED'
        | 'TIMESTAMP_FUTURE'
        | 'SIGNATURE_MISMATCH'
        | 'MISSING_BEARER'
        | 'INVALID_BEARER';
      readonly message: string;
    };

const CODE_MAP: Record<WebhookSignatureErrorCode, Exclude<VerifyResult, { ok: true }>['code']> = {
  // The hook never calls the SDK without a secret, but map it defensively —
  // an empty secret must read as a verification failure, not a bypass.
  missing_secret: 'SIGNATURE_MISMATCH',
  missing_signature: 'MISSING_SIGNATURE',
  missing_timestamp: 'MISSING_TIMESTAMP',
  invalid_timestamp: 'TIMESTAMP_INVALID',
  timestamp_expired: 'TIMESTAMP_EXPIRED',
  timestamp_in_future: 'TIMESTAMP_FUTURE',
  invalid_signature: 'SIGNATURE_MISMATCH',
  // Bearer-gate codes (SDK ≥0.9.9): unreachable until the hook opts into
  // `expectedBearerToken` — mapped so the code map stays total.
  missing_bearer: 'MISSING_BEARER',
  invalid_bearer: 'INVALID_BEARER',
};

/**
 * HMAC verification via the SDK, adapted to a `VerifyResult` discriminated
 * union so the caller (Fastify hook, tests, etc.) decides how to respond.
 */
export function verifyFlowCatalystSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  secret: string,
  options?: VerifyOptions,
): VerifyResult {
  try {
    verifyDeliverySignature({
      rawBody,
      signature,
      timestamp,
      secret,
      ...(options?.toleranceSeconds !== undefined
        ? { toleranceSeconds: options.toleranceSeconds }
        : {}),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return { ok: false, code: CODE_MAP[error.code], message: error.message };
    }
    throw error;
  }
}

export interface WebhookAuthHookOptions {
  /** Shared secret from `FLOWCATALYST_SIGNING_SECRET`. When undefined, the hook skips verification (dev mode). */
  readonly signingSecret: string | undefined;
  /** Override the replay tolerance (mainly for tests). */
  readonly verifyOptions?: VerifyOptions;
}

/**
 * Build a Fastify `preHandler` hook that verifies the FlowCatalyst HMAC
 * signature on the request before the route handler runs.
 *
 * The hook expects `request.rawBody` to be populated by the content-type
 * parser registered in `server.ts`. If the raw body is missing (parser not
 * registered or non-JSON content), it 415s.
 *
 * Use inside a plugin scope (the reactor plugin) so it only applies to
 * webhook routes — public routes don't get the verification penalty.
 */
export function flowcatalystWebhookAuthHook(options: WebhookAuthHookOptions) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!options.signingSecret) {
      request.log.warn(
        { route: request.routeOptions?.url },
        'FLOWCATALYST_SIGNING_SECRET is not set — accepting webhook unverified (DEV ONLY).',
      );
      return;
    }

    if (request.rawBody === undefined) {
      await reply.code(415).send({
        error: {
          type: 'ValidationError',
          code: 'RAW_BODY_UNAVAILABLE',
          message:
            'Webhook signature verification requires a raw JSON body — register the raw-body content-type parser before this plugin.',
        },
      });
      return;
    }

    const result = verifyFlowCatalystSignature(
      request.rawBody,
      readHeader(request.headers[FC_SIGNATURE_HEADER]),
      readHeader(request.headers[FC_TIMESTAMP_HEADER]),
      options.signingSecret,
      options.verifyOptions,
    );

    if (!result.ok) {
      request.log.warn(
        { code: result.code, route: request.routeOptions?.url },
        'FlowCatalyst webhook signature verification failed',
      );
      await reply.code(401).send({
        error: {
          type: 'AuthorizationError',
          code: result.code,
          message: result.message,
        },
      });
      return;
    }
  };
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}
