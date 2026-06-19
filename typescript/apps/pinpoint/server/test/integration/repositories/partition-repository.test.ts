import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import { Client } from '../../../src/domain/tenancy/client.js';
import { Partition } from '../../../src/domain/tenancy/partition.js';
import {
  asClientId,
  asPartitionId,
  CLIENT_ID_PREFIX,
  PARTITION_ID_PREFIX,
  type ClientId,
} from '../../../src/domain/tenancy/ids.js';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { createDrizzlePartitionRepository } from '../../../src/infrastructure/partition-repository.js';
import type { PartitionRepository } from '../../../src/domain/tenancy/partition.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

async function persistClient(
  clientRepo: ReturnType<typeof createDrizzleClientRepository>,
): Promise<ClientId> {
  const client = Client.create({
    id: asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`),
    name: 'Acme',
    code: `ACME_${generateTsid()}`,
    now: new Date(),
  });
  await clientRepo.persist(client);
  return client.id;
}

function newPartition(clientId: ClientId, code: string, name = 'Default') {
  return Partition.create({
    id: asPartitionId(`${PARTITION_ID_PREFIX}_${generateTsid()}`),
    clientId,
    code,
    name,
    now: new Date(),
  });
}

describe('PartitionRepository (integration)', () => {
  let repo: PartitionRepository;
  let clientRepo: ReturnType<typeof createDrizzleClientRepository>;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzlePartitionRepository(db);
    clientRepo = createDrizzleClientRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('persists + finds by id', async () => {
    const clientId = await persistClient(clientRepo);
    const partition = newPartition(clientId, 'P1');
    await repo.persist(partition);

    const fetched = await repo.findById(partition.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.code).toBe('P1');
    expect(fetched?.clientId).toBe(clientId);
  });

  it('findByClientAndCode resolves the right partition when codes collide across clients', async () => {
    const clientA = await persistClient(clientRepo);
    const clientB = await persistClient(clientRepo);

    const partitionA = newPartition(clientA, 'SHARED', 'A side');
    const partitionB = newPartition(clientB, 'SHARED', 'B side');
    await repo.persist(partitionA);
    await repo.persist(partitionB);

    const a = await repo.findByClientAndCode(clientA, 'SHARED');
    const b = await repo.findByClientAndCode(clientB, 'SHARED');

    expect(a?.id).toBe(partitionA.id);
    expect(b?.id).toBe(partitionB.id);
  });

  it('listByClient is scoped to the client', async () => {
    const clientA = await persistClient(clientRepo);
    const clientB = await persistClient(clientRepo);

    await repo.persist(newPartition(clientA, 'A1'));
    await repo.persist(newPartition(clientA, 'A2'));
    await repo.persist(newPartition(clientB, 'B1'));

    const partitionsA = await repo.listByClient(clientA);
    const partitionsB = await repo.listByClient(clientB);

    expect(partitionsA).toHaveLength(2);
    expect(partitionsB).toHaveLength(1);
    expect(partitionsA.map((p) => p.code).toSorted()).toEqual(['A1', 'A2']);
  });

  it('persist upserts and applies updates', async () => {
    const clientId = await persistClient(clientRepo);
    const partition = newPartition(clientId, 'P1', 'Original');
    await repo.persist(partition);

    const updated = Partition.update(partition, {
      name: 'Renamed',
      description: 'desc',
      now: new Date(),
    });
    await repo.persist(updated);

    const fetched = await repo.findById(partition.id);
    expect(fetched?.name).toBe('Renamed');
    expect(fetched?.description).toBe('desc');
  });
});
