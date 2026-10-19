/**
 * Request log end to end over HTTP: a real create-location request through
 * the real route is logged (attributed to the client's default partition via
 * the response), then read back through the usage report, the list and the
 * detail routes — and the reporting permissions are enforced.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Scope, ScopeStore } from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../src/app-context.js';
import { ALL_PERMISSIONS_SET } from '../../../src/auth/role-permissions.js';
import { registerRequestLog } from '../../../src/api/plugins/request-log.js';
import { SHARED_SCHEMAS } from '../../../src/api/plugins/shared-schemas.js';
import { registerLocationRoutes } from '../../../src/api/routes/locations/index.js';
import { registerReportingRoutes } from '../../../src/api/routes/reporting/index.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { installFetchMock, jsonResponse, type FetchMock } from '../fetch-mock.js';
import { getTestAppContext } from '../test-app-context.js';
import { seedClient } from '../use-cases/_operator-seeds.js';

describe('request log + reporting routes (integration)', () => {
  let appContext: AppContext;
  let server: FastifyInstance;
  let mock: FetchMock;

  beforeAll(async () => {
    await getDbFixture();
    // create-location parses addresses with libpostal on this branch; stub it.
    // Harmless (unused) once matching no longer parses (pinpoint/clef-decisions).
    mock = installFetchMock();
    mock.handle('GET', /\/parse\b/, () =>
      jsonResponse([
        { label: 'house_number', value: '16' },
        { label: 'road', value: 'curvy road' },
        { label: 'city', value: 'randburg' },
        { label: 'country', value: 'south africa' },
      ]),
    );
    mock.handle('GET', /\/expand\b/, (url) =>
      jsonResponse([url.searchParams.get('address') ?? '']),
    );
    appContext = await getTestAppContext();
    server = Fastify();
    for (const schema of SHARED_SCHEMAS) server.addSchema(schema);
    // `x-perms: none` binds a scope without the reporting permissions.
    server.addHook('onRequest', (req, _reply, done) => {
      const permissions =
        req.headers['x-perms'] === 'none'
          ? new Set<string>([PinpointPermission.LocationsLocationCreate])
          : ALL_PERMISSIONS_SET;
      ScopeStore.run(Scope.fromRequest({ sub: 'prn_caller', permissions }), done);
    });
    registerRequestLog(server, { repository: appContext.repositories.requestLogs });
    registerLocationRoutes(server, appContext);
    registerReportingRoutes(server, appContext);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    mock.restore();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  /** The log write is fire-and-forget after the reply; wait for it to land. */
  async function waitForLogs(count: number): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const page = await appContext.repositories.requestLogs.list({
        from: new Date(0),
        to: new Date(Date.now() + 60_000),
        limit: 1,
        offset: 0,
      });
      if (page.total >= count) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`expected ${count} request log rows`);
  }

  it('logs a create-location request and reports it', async () => {
    const { clientId, defaultPartitionId } = await seedClient(appContext);

    const created = await server.inject({
      method: 'POST',
      url: `/clients/${clientId}/locations`,
      payload: { address: '16 Curvy Road, Randburg', name: 'Home' },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().partitionId).toBe(defaultPartitionId);
    await waitForLogs(1);

    const usage = await server.inject({ method: 'GET', url: '/reports/usage?period=day' });
    expect(usage.statusCode).toBe(200);
    expect(usage.json().rows).toEqual([
      expect.objectContaining({
        clientId,
        partitionId: defaultPartitionId,
        partitionCode: 'default',
        operation: 'createLocation',
        requests: 1,
        errors: 0,
      }),
    ]);

    const list = await server.inject({ method: 'GET', url: `/request-logs?clientId=${clientId}` });
    expect(list.statusCode).toBe(200);
    const [entry] = list.json().entries;
    expect(entry).toMatchObject({
      operation: 'createLocation',
      principalId: 'prn_caller',
      statusCode: 201,
    });

    const detail = await server.inject({ method: 'GET', url: `/request-logs/${entry.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().requestBody).toEqual({ address: '16 Curvy Road, Randburg', name: 'Home' });
    expect(detail.json().responseBody).toMatchObject({ partitionId: defaultPartitionId });

    // Reading the reports is not itself logged.
    const all = await appContext.repositories.requestLogs.list({
      from: new Date(0),
      to: new Date(Date.now() + 60_000),
      limit: 10,
      offset: 0,
    });
    expect(all.total).toBe(1);
  });

  it('enforces the reporting permissions', async () => {
    const usage = await server.inject({
      method: 'GET',
      url: '/reports/usage',
      headers: { 'x-perms': 'none' },
    });
    expect(usage.statusCode).toBe(403);
    const logs = await server.inject({
      method: 'GET',
      url: '/request-logs',
      headers: { 'x-perms': 'none' },
    });
    expect(logs.statusCode).toBe(403);
  });

  it('rejects an unknown timezone and 404s an unknown log id', async () => {
    const bad = await server.inject({ method: 'GET', url: '/reports/usage?timezone=Mars/Olympus' });
    expect(bad.statusCode).toBe(400);
    const missing = await server.inject({ method: 'GET', url: '/request-logs/rql_nope' });
    expect(missing.statusCode).toBe(404);
  });
});
