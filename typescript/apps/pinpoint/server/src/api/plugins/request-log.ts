/**
 * Request log capture. Every API request — its operation, the client /
 * partition / principal it is attributed to, the body sent, the body returned,
 * the status and the duration — is written to `request_logs` once the
 * response has gone out. Feeds the usage report and request inspection
 * (`api/routes/reporting`).
 *
 * Logged: the canonical API surface (`/clients/…`, `/geocode/…`, …). Not
 * logged: the SPA's BFF, auth, docs, health, platform job webhooks, static
 * files, unmatched routes, and the reporting routes themselves.
 *
 * Writing never affects the request: it happens in `onResponse`, after the
 * reply is sent, and failures are reported to `onError` and dropped.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { RequestLogRepository } from '../../domain/reporting/request-log.repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestLogCapture?: { responseBody: unknown; principalId: string | null };
  }
}

const EXCLUDED_PREFIXES = [
  '/bff',
  '/auth',
  '/docs',
  '/health',
  '/jobs',
  '/reports',
  '/request-logs',
];

/** Default cap on each stored body, in bytes of its JSON serialisation. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export interface RequestLogPluginOptions {
  readonly repository: RequestLogRepository;
  readonly maxBodyBytes?: number;
  readonly onError?: (err: unknown) => void;
}

/** Whether a matched route (its pattern) is part of the logged API surface. */
export function isLoggedRoute(routePattern: string | undefined): routePattern is string {
  if (!routePattern || routePattern === '*' || routePattern.startsWith('/*')) return false;
  return !EXCLUDED_PREFIXES.some((p) => routePattern === p || routePattern.startsWith(`${p}/`));
}

function stringField(source: unknown, key: string): string | null {
  if (source === null || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Which client and partition a request belongs to. The response wins for the
 * partition — create-location resolves the client's default partition when
 * the caller sends none, and reports it back.
 */
export function attributeRequest(input: {
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
  readonly responseBody: unknown;
}): { clientId: string | null; partitionId: string | null } {
  const { params, query, body, responseBody } = input;
  return {
    clientId:
      stringField(params, 'clientId') ??
      stringField(body, 'clientId') ??
      stringField(query, 'clientId') ??
      stringField(responseBody, 'clientId'),
    partitionId:
      stringField(responseBody, 'partitionId') ??
      stringField(body, 'partitionId') ??
      stringField(query, 'partitionId') ??
      stringField(params, 'partitionId'),
  };
}

/** A reply payload as stored: parsed JSON when it is JSON, else the text. */
export function parsePayload(payload: unknown): unknown {
  const text =
    typeof payload === 'string'
      ? payload
      : Buffer.isBuffer(payload)
        ? payload.toString('utf8')
        : null;
  if (text === null || text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * The value itself when its JSON is within `maxBytes`, otherwise a marker
 * carrying the size and the head of the serialisation.
 */
export function boundedBody(value: unknown, maxBytes: number): unknown {
  if (value === undefined || value === null) return null;
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= maxBytes) return value;
  return { _truncated: true, bytes, head: json.slice(0, maxBytes) };
}

export function registerRequestLog(
  server: FastifyInstance,
  options: RequestLogPluginOptions,
): void {
  const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  // onSend still runs inside the request's ALS scope (bound in onRequest), so
  // the principal is read here; onResponse may run outside it.
  server.addHook('onSend', (request, _reply, payload, done) => {
    if (isLoggedRoute(request.routeOptions.url)) {
      request.requestLogCapture = {
        responseBody: parsePayload(payload),
        principalId: ScopeStore.get()?.principalId ?? null,
      };
    }
    done(null, payload);
  });

  server.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done) => {
    const route = request.routeOptions.url;
    const capture = request.requestLogCapture;
    if (isLoggedRoute(route) && capture) {
      const { clientId, partitionId } = attributeRequest({
        params: request.params,
        query: request.query,
        body: request.body,
        responseBody: capture.responseBody,
      });
      const operation =
        (request.routeOptions.schema as { operationId?: string } | undefined)?.operationId ?? route;
      options.repository
        .record({
          clientId,
          partitionId,
          principalId: capture.principalId,
          operation,
          method: request.method,
          route,
          url: request.url,
          statusCode: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
          requestBody: boundedBody(request.body, maxBytes),
          responseBody: boundedBody(capture.responseBody, maxBytes),
        })
        .catch((err: unknown) => options.onError?.(err));
    }
    done();
  });
}
