/**
 * Request-log capture: the pure helpers, plus the hooks on a real Fastify
 * instance with a fake repository (no DB) — what gets recorded, for which
 * routes, attributed to whom.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scope, ScopeStore } from '@pinpoint/framework';
import type {
  NewRequestLogEntry,
  RequestLogRepository,
} from '../../domain/reporting/request-log.repository.js';
import {
  attributeRequest,
  boundedBody,
  canonicalOperation,
  isLoggedRoute,
  parsePayload,
  registerRequestLog,
  surfaceOf,
  withoutThirdPartyCoordinates,
} from './request-log.js';

describe('isLoggedRoute', () => {
  it.each(['/clients/:clientId/locations', '/geocode/forward', '/clients', '/verify-match'])(
    'logs %s',
    (route) => expect(isLoggedRoute(route)).toBe(true),
  );

  it.each([
    '/auth/login',
    '/docs',
    '/docs/json',
    '/health',
    '/jobs/validate-master-locations',
    '/reports/usage',
    '/request-logs/:id',
    '/*',
    undefined,
  ])('does not log %s', (route) => expect(isLoggedRoute(route)).toBe(false));

  it('logs BFF actions but not BFF reads', () => {
    expect(isLoggedRoute('/bff/clients/:clientId/locations', 'POST')).toBe(true);
    expect(isLoggedRoute('/bff/clients/:clientId/locations/:locationId', 'DELETE')).toBe(true);
    expect(isLoggedRoute('/bff/clients/:clientId/locations', 'GET')).toBe(false);
    expect(isLoggedRoute('/bff/reports/usage', 'POST')).toBe(false);
  });

  it('tags the surface', () => {
    expect(surfaceOf('/bff/clients/:clientId/locations')).toBe('UI');
    expect(surfaceOf('/clients/:clientId/locations')).toBe('API');
  });
});

describe('canonicalOperation', () => {
  it.each([
    ['bffCreateLocation', 'createLocation'],
    ['bffValidateMasterLocation', 'confirmMasterLocation'],
    ['bffGeocodeMasterLocation', 'validateMasterLocation'],
    ['createLocation', 'createLocation'],
    ['bff', 'bff'],
  ])('%s → %s', (input, expected) => expect(canonicalOperation(input)).toBe(expected));
});

describe('withoutThirdPartyCoordinates', () => {
  it('blanks Google coordinates, nested too, and keeps our own', () => {
    expect(
      withoutThirdPartyCoordinates({
        latitude: -26.1,
        longitude: 28.0,
        source: 'GOOGLE_MAPS',
        address: { city: 'Randburg' },
        others: [{ latitude: 1, longitude: 2, geocodeSource: 'GOOGLE_MAPS' }],
        mine: { latitude: 3, longitude: 4, source: 'PHOTON' },
      }),
    ).toEqual({
      latitude: null,
      longitude: null,
      source: 'GOOGLE_MAPS',
      _coordinatesRedacted: 'GOOGLE_MAPS',
      address: { city: 'Randburg' },
      others: [
        {
          latitude: null,
          longitude: null,
          geocodeSource: 'GOOGLE_MAPS',
          _coordinatesRedacted: 'GOOGLE_MAPS',
        },
      ],
      mine: { latitude: 3, longitude: 4, source: 'PHOTON' },
    });
    expect(withoutThirdPartyCoordinates('text')).toBe('text');
  });
});

describe('attributeRequest', () => {
  it('takes the client from the path and the partition from the response first', () => {
    expect(
      attributeRequest({
        params: { clientId: 'cli_1' },
        query: { partitionId: 'par_query' },
        body: { partitionId: null },
        responseBody: { partitionId: 'par_default' },
      }),
    ).toEqual({ clientId: 'cli_1', partitionId: 'par_default' });
  });

  it('falls back through body, query and params', () => {
    expect(
      attributeRequest({
        params: { partitionId: 'par_path' },
        query: {},
        body: { clientId: 'cli_body' },
        responseBody: 'not json',
      }),
    ).toEqual({ clientId: 'cli_body', partitionId: 'par_path' });
  });

  it('returns nulls for an unscoped request', () => {
    expect(
      attributeRequest({ params: {}, query: undefined, body: undefined, responseBody: null }),
    ).toEqual({ clientId: null, partitionId: null });
  });
});

describe('parsePayload / boundedBody', () => {
  it('parses JSON payloads and keeps non-JSON as text', () => {
    expect(parsePayload('{"a":1}')).toEqual({ a: 1 });
    expect(parsePayload(Buffer.from('{"b":2}'))).toEqual({ b: 2 });
    expect(parsePayload('plain')).toBe('plain');
    expect(parsePayload('')).toBeNull();
  });

  it('keeps a body under the cap and marks one over it', () => {
    expect(boundedBody({ a: 'x' }, 100)).toEqual({ a: 'x' });
    const big = boundedBody({ a: 'x'.repeat(200) }, 50) as Record<string, unknown>;
    expect(big['_truncated']).toBe(true);
    expect(big['bytes']).toBe(JSON.stringify({ a: 'x'.repeat(200) }).length);
    expect(String(big['head'])).toHaveLength(50);
    expect(boundedBody(undefined, 50)).toBeNull();
  });
});

describe('registerRequestLog hooks', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  async function build(record: RequestLogRepository['record']): Promise<FastifyInstance> {
    const repository = { record } as unknown as RequestLogRepository;
    server = Fastify();
    // Bind a scope the way server.ts does, when a principal header is present.
    server.addHook('onRequest', (req, _reply, done) => {
      const sub = req.headers['x-user-id'];
      if (typeof sub === 'string') {
        ScopeStore.run(Scope.fromRequest({ sub, permissions: new Set() }), done);
      } else {
        done();
      }
    });
    registerRequestLog(server, { repository, maxBodyBytes: 1024 });
    server.post(
      '/clients/:clientId/locations',
      { schema: { operationId: 'createLocation' } },
      async (_req, reply) =>
        reply.code(201).send({ locationId: 'loc_1', partitionId: 'par_default' }),
    );
    server.post(
      '/bff/clients/:clientId/locations',
      { schema: { operationId: 'bffCreateLocation' } },
      async () => ({ ok: true }),
    );
    server.get('/bff/clients/:clientId/locations', async () => ({ locations: [] }));
    server.get(
      '/geocode/forward',
      { schema: { operationId: 'forwardGeocode' } },
      async (_req, reply) => reply.code(422).send({ error: 'NoGeocodingMatch' }),
    );
    await server.ready();
    return server;
  }

  /** onResponse fires after the reply; give the fire-and-forget write a tick. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('records operation, attribution, principal, bodies and status', async () => {
    const record = vi.fn<RequestLogRepository['record']>().mockResolvedValue();
    await build(record);

    await server.inject({
      method: 'POST',
      url: '/clients/cli_1/locations?x=1',
      headers: { 'x-user-id': 'prn_caller' },
      payload: { address: '16 Curvy Road, Randburg' },
    });
    await settle();

    expect(record).toHaveBeenCalledOnce();
    const entry = record.mock.calls[0]![0] as NewRequestLogEntry;
    expect(entry).toMatchObject({
      surface: 'API',
      clientId: 'cli_1',
      partitionId: 'par_default',
      principalId: 'prn_caller',
      operation: 'createLocation',
      method: 'POST',
      route: '/clients/:clientId/locations',
      url: '/clients/cli_1/locations?x=1',
      statusCode: 201,
      requestBody: { address: '16 Curvy Road, Randburg' },
      responseBody: { locationId: 'loc_1', partitionId: 'par_default' },
    });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records failed requests too', async () => {
    const record = vi.fn<RequestLogRepository['record']>().mockResolvedValue();
    await build(record);

    await server.inject({ method: 'GET', url: '/geocode/forward' });
    await settle();

    expect(record.mock.calls[0]![0]).toMatchObject({
      operation: 'forwardGeocode',
      statusCode: 422,
      clientId: null,
      principalId: null,
    });
  });

  it('records a BFF action as the canonical operation from the UI, and skips BFF reads', async () => {
    const record = vi.fn<RequestLogRepository['record']>().mockResolvedValue();
    await build(record);

    await server.inject({ method: 'POST', url: '/bff/clients/cli_1/locations', payload: {} });
    await server.inject({ method: 'GET', url: '/bff/clients/cli_1/locations' });
    await settle();

    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]![0]).toMatchObject({
      surface: 'UI',
      operation: 'createLocation',
      clientId: 'cli_1',
    });
  });

  it('a failed write is reported, never surfaced to the caller', async () => {
    const record = vi.fn<RequestLogRepository['record']>().mockRejectedValue(new Error('db down'));
    const onError = vi.fn();
    server = Fastify();
    registerRequestLog(server, { repository: { record } as never, onError });
    server.get('/clients', { schema: { operationId: 'listClients' } }, async () => ({
      clients: [],
    }));

    const res = await server.inject({ method: 'GET', url: '/clients' });
    await settle();

    expect(res.statusCode).toBe(200);
    expect(onError).toHaveBeenCalledOnce();
  });
});
