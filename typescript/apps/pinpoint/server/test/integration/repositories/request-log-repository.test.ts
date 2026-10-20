/**
 * Request-log repository against the real schema: usage aggregation by
 * month / week / day, timezone-cut periods, client + partition codes, error
 * counts, the default window, listing, and pruning.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import { requestLogs } from '../../../src/infrastructure/schema.js';
import { createDrizzleRequestLogRepository } from '../../../src/infrastructure/request-log-repository.js';
import type { RequestLogRepository } from '../../../src/domain/reporting/request-log.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext } from '../test-app-context.js';
import { seedClient } from '../use-cases/_operator-seeds.js';

describe('RequestLogRepository (integration)', () => {
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  let repo: RequestLogRepository;

  beforeAll(async () => {
    db = (await getDbFixture()).db;
    repo = createDrizzleRequestLogRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  async function log(
    createdAt: string,
    fields: {
      clientId?: string | null;
      partitionId?: string | null;
      operation?: string;
      status?: number;
    } = {},
  ): Promise<void> {
    await db.insert(requestLogs).values({
      id: `rql_${generateTsid()}`,
      createdAt: new Date(createdAt),
      clientId: fields.clientId ?? null,
      partitionId: fields.partitionId ?? null,
      principalId: 'prn_test',
      operation: fields.operation ?? 'createLocation',
      method: 'POST',
      route: '/clients/:clientId/locations',
      url: '/clients/x/locations',
      statusCode: fields.status ?? 201,
      durationMs: 12,
      requestBody: { address: 'a' },
      responseBody: { locationId: 'loc_1' },
    });
  }

  const WINDOW = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') };

  it('counts per month, client, partition and operation, with codes and errors', async () => {
    const appContext = await getTestAppContext();
    const acme = await seedClient(appContext);
    await log('2026-03-02T10:00:00Z', {
      clientId: acme.clientId,
      partitionId: acme.defaultPartitionId,
    });
    await log('2026-03-20T10:00:00Z', {
      clientId: acme.clientId,
      partitionId: acme.defaultPartitionId,
      status: 422,
    });
    await log('2026-04-01T10:00:00Z', {
      clientId: acme.clientId,
      partitionId: acme.defaultPartitionId,
    });
    await log('2026-03-05T10:00:00Z', { operation: 'forwardGeocode' });

    const report = await repo.usage({ period: 'month', timezone: 'UTC', ...WINDOW });
    const client = await appContext.repositories.clients.findById(acme.clientId);

    expect(report.rows).toEqual([
      {
        periodStart: '2026-03-01',
        clientId: acme.clientId,
        clientCode: client!.code,
        partitionId: acme.defaultPartitionId,
        partitionCode: 'default',
        operation: 'createLocation',
        requests: 2,
        errors: 1,
      },
      {
        periodStart: '2026-03-01',
        clientId: null,
        clientCode: null,
        partitionId: null,
        partitionCode: null,
        operation: 'forwardGeocode',
        requests: 1,
        errors: 0,
      },
      {
        periodStart: '2026-04-01',
        clientId: acme.clientId,
        clientCode: client!.code,
        partitionId: acme.defaultPartitionId,
        partitionCode: 'default',
        operation: 'createLocation',
        requests: 1,
        errors: 0,
      },
    ]);
  });

  it('buckets by ISO week (Monday start) and by day', async () => {
    await log('2026-03-01T10:00:00Z'); // Sunday → week of Mon 23 Feb
    await log('2026-03-02T10:00:00Z'); // Monday
    await log('2026-03-03T10:00:00Z'); // Tuesday, same week

    const weeks = await repo.usage({ period: 'week', timezone: 'UTC', ...WINDOW });
    expect(weeks.rows.map((r) => [r.periodStart, r.requests])).toEqual([
      ['2026-02-23', 1],
      ['2026-03-02', 2],
    ]);

    const days = await repo.usage({ period: 'day', timezone: 'UTC', ...WINDOW });
    expect(days.rows.map((r) => r.periodStart)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
  });

  it('cuts periods in the requested timezone', async () => {
    // 23:30 UTC on 31 March is 01:30 on 1 April in Johannesburg (UTC+2).
    await log('2026-03-31T23:30:00Z');

    const utc = await repo.usage({ period: 'month', timezone: 'UTC', ...WINDOW });
    const jhb = await repo.usage({ period: 'month', timezone: 'Africa/Johannesburg', ...WINDOW });

    expect(utc.rows[0]?.periodStart).toBe('2026-03-01');
    expect(jhb.rows[0]?.periodStart).toBe('2026-04-01');
  });

  it('filters by client, partition and operation', async () => {
    await log('2026-03-02T10:00:00Z', { clientId: 'cli_a', operation: 'createLocation' });
    await log('2026-03-02T10:00:00Z', { clientId: 'cli_b', operation: 'createLocation' });
    await log('2026-03-02T10:00:00Z', { clientId: 'cli_a', operation: 'listLocations' });

    const a = await repo.usage({ period: 'month', timezone: 'UTC', ...WINDOW, clientId: 'cli_a' });
    expect(a.rows.map((r) => r.operation)).toEqual(['createLocation', 'listLocations']);

    const creates = await repo.usage({
      period: 'month',
      timezone: 'UTC',
      ...WINDOW,
      operation: 'createLocation',
    });
    expect(creates.rows.map((r) => r.clientId)).toEqual(['cli_a', 'cli_b']);
  });

  it('defaults the window to whole periods: 12 months back from the current one', async () => {
    const report = await repo.usage({ period: 'month', timezone: 'UTC', to: new Date() });
    const now = new Date();
    const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    expect(report.from.toISOString()).toBe(expected.toISOString());
  });

  it('lists newest first without bodies, finds one with bodies, and prunes old rows', async () => {
    await log('2026-01-10T10:00:00Z');
    await log('2026-03-10T10:00:00Z');

    const page = await repo.list({ ...WINDOW, limit: 10, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.entries.map((e) => e.createdAt.toISOString())).toEqual([
      '2026-03-10T10:00:00.000Z',
      '2026-01-10T10:00:00.000Z',
    ]);
    expect(page.entries[0]).not.toHaveProperty('requestBody');

    const one = await repo.findById(page.entries[0]!.id);
    expect(one?.requestBody).toEqual({ address: 'a' });
    expect(one?.responseBody).toEqual({ locationId: 'loc_1' });

    expect(await repo.pruneBefore(new Date('2026-02-01T00:00:00Z'))).toBe(1);
    expect((await repo.list({ ...WINDOW, limit: 10, offset: 0 })).total).toBe(1);
  });
});
