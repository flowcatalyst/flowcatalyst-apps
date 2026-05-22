/**
 * Integration test for MatchingConfigRepository — verifies the
 * scope-resolution cascade (client+partition → client → global).
 * The fixture seeds mcf_GLOBAL_DEFAULT via the seed_globals migration,
 * so resolve() always has a fallback.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  MATCHING_CONFIG_ID_PREFIX,
  asMatchingConfigId,
} from '../../../src/domain/matching/ids.js';
import {
  asClientId,
  asPartitionId,
  CLIENT_ID_PREFIX,
  PARTITION_ID_PREFIX,
} from '../../../src/domain/tenancy/ids.js';
import { Client } from '../../../src/domain/tenancy/client.js';
import { Partition } from '../../../src/domain/tenancy/partition.js';
import { MatchingConfig } from '../../../src/domain/matching/matching-config.js';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { createDrizzlePartitionRepository } from '../../../src/infrastructure/partition-repository.js';
import { createDrizzleMatchingConfigRepository } from '../../../src/infrastructure/matching-config-repository.js';
import type { MatchingConfigRepository } from '../../../src/domain/matching/matching-config.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

describe('MatchingConfigRepository (integration)', () => {
  let repo: MatchingConfigRepository;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzleMatchingConfigRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('falls back to the global default when no scoped row exists', async () => {
    const cfg = await repo.resolve(asClientId('cli_ghost'), null);
    expect(cfg.id).toBe('mcf_GLOBAL_DEFAULT');
    expect(cfg.clientId).toBeNull();
    expect(cfg.partitionId).toBeNull();
  });

  it('prefers the most-specific row when multiple exist', async () => {
    // matching_configs FKs to clients + partitions, so seed those
    // parent rows before inserting scoped configs.
    const { db } = await getDbFixture();
    const clientRepo = createDrizzleClientRepository(db);
    const partitionRepo = createDrizzlePartitionRepository(db);

    const clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    const partitionId = asPartitionId(`${PARTITION_ID_PREFIX}_${generateTsid()}`);
    const now = new Date();
    await clientRepo.persist(
      Client.create({ id: clientId, name: 'MC Test', code: `MC_${generateTsid()}`, now }),
    );
    await partitionRepo.persist(
      Partition.create({ id: partitionId, clientId, code: 'eu', name: 'Europe', now }),
    );

    // Three rows: global already exists from seed; add client-scoped
    // and partition-scoped.
    await repo.persist(
      MatchingConfig.create({
        id: asMatchingConfigId(`${MATCHING_CONFIG_ID_PREFIX}_${generateTsid()}`),
        clientId,
        partitionId: null,
        thresholds: { streetThreshold: 0.7 },
        now,
      }),
    );
    await repo.persist(
      MatchingConfig.create({
        id: asMatchingConfigId(`${MATCHING_CONFIG_ID_PREFIX}_${generateTsid()}`),
        clientId,
        partitionId,
        thresholds: { streetThreshold: 0.5 },
        now,
      }),
    );

    // (client, partition) → the partition row wins
    const both = await repo.resolve(clientId, partitionId);
    expect(both.streetThreshold).toBe(0.5);

    // (client, null) → the client row wins (next most specific)
    const clientOnly = await repo.resolve(clientId, null);
    expect(clientOnly.streetThreshold).toBe(0.7);

    // (other client, null) → falls through to the global default
    const stranger = await repo.resolve(asClientId('cli_other'), null);
    expect(stranger.id).toBe('mcf_GLOBAL_DEFAULT');
  });
});
