/**
 * Request log capture. Every API request — its operation, the client /
 * partition / principal it is attributed to, the body sent, the body returned,
 * the status and the duration — is written to `request_logs` once the
 * response has gone out. Feeds the usage report and request inspection
 * (`api/routes/reporting`).
 *
 * Logged: every canonical API request (`/clients/…`, `/geocode/…`, …) —
 * surface `API` — and the SPA's actions through the BFF (its POST / PUT /
 * PATCH / DELETE, which run the same use cases) — surface `UI`. A BFF action
 * is recorded under the canonical operation name (`bffCreateLocation` →
 * `createLocation`), so usage counts an operation the same whichever surface
 * ran it. Not logged: the SPA's page / list reads, auth, docs, health,
 * platform job webhooks, static files, unmatched routes, and the reporting
 * routes themselves.
 *
 * Google Maps coordinates may only be cached for 30 days, and request logs
 * are kept far longer, so any object in a stored body that says its source
 * is `GOOGLE_MAPS` has its latitude / longitude blanked.
 *
 * Writing never affects the request: it happens in `onResponse`, after the
 * reply is sent, and failures are reported to `onError` and dropped.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type {
  RequestLogRepository,
  RequestSurface,
} from '../../domain/reporting/request-log.repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestLogCapture?: { responseBody: unknown; principalId: string | null };
  }
}

const BFF_PREFIX = '/bff';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const EXCLUDED_PREFIXES = [
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

function under(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(`${prefix}/`);
}

/** The surface a route pattern belongs to. */
export function surfaceOf(routePattern: string): RequestSurface {
  return under(routePattern, BFF_PREFIX) ? 'UI' : 'API';
}

/**
 * Whether a request is logged: any canonical API route, or a BFF action (not
 * a read). Excluded prefixes apply to both surfaces (`/bff/reports` too).
 */
export function isLoggedRoute(
  routePattern: string | undefined,
  method = 'POST',
): routePattern is string {
  if (!routePattern || routePattern === '*' || routePattern.startsWith('/*')) return false;
  const bff = under(routePattern, BFF_PREFIX);
  if (bff && READ_METHODS.has(method.toUpperCase())) return false;
  const path = bff ? routePattern.slice(BFF_PREFIX.length) || '/' : routePattern;
  return !EXCLUDED_PREFIXES.some((p) => under(path, p));
}

/**
 * BFF actions whose name differs from the canonical operation running the same
 * use case (the BFF "validate" confirms; its "geocode" is the canonical
 * `validateMasterLocation`, which geocodes).
 */
const BFF_OPERATION_ALIASES: Readonly<Record<string, string>> = {
  bffValidateMasterLocation: 'confirmMasterLocation',
  bffGeocodeMasterLocation: 'validateMasterLocation',
  bffConfirmGeocode: 'confirmMasterLocationGeocode',
  bffGrantAccess: 'grantPartitionAccess',
  bffRevokeAccess: 'revokePartitionAccess',
};

/**
 * A BFF operationId as the canonical one — `bffCreateLocation` →
 * `createLocation` — so an operation counts the same from either surface.
 */
export function canonicalOperation(operationId: string): string {
  const alias = BFF_OPERATION_ALIASES[operationId];
  if (alias) return alias;
  const m = /^bff([A-Z])(.*)$/.exec(operationId);
  return m ? `${m[1]!.toLowerCase()}${m[2]}` : operationId;
}

const THIRD_PARTY_SOURCES = new Set(['GOOGLE_MAPS']);

/**
 * `value` with latitude / longitude blanked on every object whose `source` or
 * `geocodeSource` is a third party whose coordinates we may not keep.
 */
export function withoutThirdPartyCoordinates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutThirdPartyCoordinates);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(record)) out[key] = withoutThirdPartyCoordinates(inner);
  const source = [record['source'], record['geocodeSource']].find(
    (s): s is string => typeof s === 'string' && THIRD_PARTY_SOURCES.has(s),
  );
  if (source && ('latitude' in record || 'longitude' in record)) {
    if ('latitude' in record) out['latitude'] = null;
    if ('longitude' in record) out['longitude'] = null;
    out['_coordinatesRedacted'] = source;
  }
  return out;
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
      stringField(params, 'cid') ??
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
    if (isLoggedRoute(request.routeOptions.url, request.method)) {
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
    if (isLoggedRoute(route, request.method) && capture) {
      const { clientId, partitionId } = attributeRequest({
        params: request.params,
        query: request.query,
        body: request.body,
        responseBody: capture.responseBody,
      });
      const operationId = (request.routeOptions.schema as { operationId?: string } | undefined)
        ?.operationId;
      options.repository
        .record({
          surface: surfaceOf(route),
          clientId,
          partitionId,
          principalId: capture.principalId,
          operation: operationId ? canonicalOperation(operationId) : route,
          method: request.method,
          route,
          url: request.url,
          statusCode: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
          requestBody: boundedBody(request.body, maxBytes),
          responseBody: boundedBody(withoutThirdPartyCoordinates(capture.responseBody), maxBytes),
        })
        .catch((err: unknown) => options.onError?.(err));
    }
    done();
  });
}
