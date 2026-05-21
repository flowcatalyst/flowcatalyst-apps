/**
 * Batch-handler tests. Exercise the orchestration logic (filter by
 * status, sequential drain, per-master error containment) with a
 * fake-repo / fake-runWrite AppContext. The actual confirm-master-location
 * use case is unit-tested separately; here we only care that the worker
 * calls it once per master and aggregates results correctly.
 */
import { Result } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { ScopeStore, type Scope } from '@pinpoint/framework';
import type { AppContext } from '../app-context.js';
import type { MasterLocation, MasterLocationStatus } from '../domain/locations/master-location.js';
import type { ClientId, PartitionId } from '../domain/tenancy/ids.js';
import type { MasterLocationId } from '../domain/locations/ids.js';
import { runValidateMasterLocationsBatch } from './validate-master-locations.js';

const NOW = new Date('2026-05-21T00:00:00Z');
const SCOPE: Scope = {
  executionId: 'exe_test',
  correlationId: 'cor_test',
  causationId: null,
  principalId: 'pinpoint:system:scheduler',
  principalType: 'SERVICE',
  initiatedAt: NOW,
  tenant: null,
} as unknown as Scope;

function master(overrides: Partial<MasterLocation> = {}): MasterLocation {
  return {
    id: 'mlo_x' as MasterLocationId,
    clientId: 'cli_x' as ClientId,
    partitionId: null as PartitionId | null,
    normalizedHouseNumber: null,
    normalizedRoad: null,
    normalizedSuburb: null,
    normalizedCity: 'Cape Town',
    normalizedState: null,
    normalizedPostalCode: null,
    normalizedCountry: 'south africa',
    addressHash: 'hash',
    normalizedAddressLine: null,
    latitude: -33.9,
    longitude: 18.4,
    status: 'GEOCODED',
    createdAt: NOW,
    updatedAt: NOW,
    validatedAt: null,
    ...overrides,
  };
}

interface FakeContextOverrides {
  readonly listByStatus?: (
    status: MasterLocationStatus,
    limit: number,
  ) => Promise<readonly MasterLocation[]>;
  readonly runWrite?: AppContext['runWrite'];
}

function fakeAppContext(overrides: FakeContextOverrides): AppContext {
  const listByStatus = overrides.listByStatus ?? (async () => []);
  const runWrite =
    overrides.runWrite ??
    (async () => Result.succeed({ event: { getData: () => ({}) } } as never));
  return {
    repositories: {
      masterLocations: { listByStatus },
    },
    useCases: {
      confirmMasterLocation: { execute: vi.fn().mockReturnValue(undefined) },
    },
    runWrite,
  } as unknown as AppContext;
}

describe('runValidateMasterLocationsBatch', () => {
  it('returns an all-zero summary when nothing is GEOCODED', async () => {
    const appContext = fakeAppContext({});
    const result = await ScopeStore.run(SCOPE, () =>
      runValidateMasterLocationsBatch(appContext),
    );
    expect(result).toEqual({
      attempted: 0,
      confirmed: 0,
      failed: 0,
      failures: [],
    });
  });

  it('calls runWrite once per GEOCODED master and counts confirmations', async () => {
    const runWrite = vi
      .fn()
      .mockResolvedValue(Result.succeed({ event: { getData: () => ({}) } } as never));

    const masters = [
      master({ id: 'mlo_1' as MasterLocationId }),
      master({ id: 'mlo_2' as MasterLocationId }),
      master({ id: 'mlo_3' as MasterLocationId }),
    ];
    const appContext = fakeAppContext({
      listByStatus: async () => masters,
      runWrite: runWrite as unknown as AppContext['runWrite'],
    });

    const result = await ScopeStore.run(SCOPE, () =>
      runValidateMasterLocationsBatch(appContext),
    );

    expect(result.attempted).toBe(3);
    expect(result.confirmed).toBe(3);
    expect(result.failed).toBe(0);
    expect(runWrite).toHaveBeenCalledTimes(3);
  });

  it('continues processing after a per-master use-case failure (Result.failure)', async () => {
    const masters = [
      master({ id: 'mlo_good_1' as MasterLocationId }),
      master({ id: 'mlo_bad' as MasterLocationId }),
      master({ id: 'mlo_good_2' as MasterLocationId }),
    ];
    let call = 0;
    const runWrite: AppContext['runWrite'] = (async () => {
      const idx = call++;
      if (idx === 1) {
        return Result.fail({
          _tag: 'BusinessRuleViolation',
          code: 'NOT_GEOCODED',
          message: 'somehow',
        }) as never;
      }
      return Result.succeed({ event: { getData: () => ({}) } } as never);
    }) as unknown as AppContext['runWrite'];

    const appContext = fakeAppContext({
      listByStatus: async () => masters,
      runWrite,
    });

    const result = await ScopeStore.run(SCOPE, () =>
      runValidateMasterLocationsBatch(appContext),
    );

    expect(result.attempted).toBe(3);
    expect(result.confirmed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.masterLocationId).toBe('mlo_bad');
    expect(result.failures[0]?.error).toContain('BusinessRuleViolation');
    expect(result.failures[0]?.error).toContain('NOT_GEOCODED');
  });

  it('catches thrown infrastructure errors from runWrite and keeps the batch going', async () => {
    const masters = [
      master({ id: 'mlo_a' as MasterLocationId }),
      master({ id: 'mlo_b' as MasterLocationId }),
    ];
    let call = 0;
    const runWrite: AppContext['runWrite'] = (async () => {
      const idx = call++;
      if (idx === 0) throw new Error('connection lost');
      return Result.succeed({ event: { getData: () => ({}) } } as never);
    }) as unknown as AppContext['runWrite'];

    const appContext = fakeAppContext({
      listByStatus: async () => masters,
      runWrite,
    });

    const result = await ScopeStore.run(SCOPE, () =>
      runValidateMasterLocationsBatch(appContext),
    );

    expect(result.attempted).toBe(2);
    expect(result.confirmed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.error).toBe('connection lost');
  });

  it('passes the configured batch size to the repository', async () => {
    const listByStatus = vi.fn().mockResolvedValue([]);
    const appContext = fakeAppContext({ listByStatus });

    await ScopeStore.run(SCOPE, () =>
      runValidateMasterLocationsBatch(appContext, { batchSize: 25 }),
    );

    expect(listByStatus).toHaveBeenCalledWith('GEOCODED', 25);
  });
});
