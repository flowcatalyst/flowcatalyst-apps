import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTsid } from '@flowcatalyst/sdk';
import { Client } from '../../../src/domain/tenancy/client.js';
import { Partition } from '../../../src/domain/tenancy/partition.js';
import {
  asClientId,
  asPartitionId,
  CLIENT_ID_PREFIX,
  PARTITION_ID_PREFIX,
} from '../../../src/domain/tenancy/ids.js';
import { asPrincipalId, type PrincipalId } from '../../../src/domain/auth/ids.js';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { createDrizzlePartitionRepository } from '../../../src/infrastructure/partition-repository.js';
import { createDrizzlePrincipalRepository } from '../../../src/infrastructure/principal-repository.js';
import type { PrincipalRepository } from '../../../src/domain/auth/principal.repository.js';
import type { PartitionId } from '../../../src/domain/tenancy/ids.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

async function setupClientAndPartition(
  clientRepo: ReturnType<typeof createDrizzleClientRepository>,
  partitionRepo: ReturnType<typeof createDrizzlePartitionRepository>,
): Promise<PartitionId> {
  const clientId = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
  await clientRepo.persist(
    Client.create({ id: clientId, name: 'Acme', code: `ACME_${generateTsid()}`, now: new Date() }),
  );
  const partitionId = asPartitionId(`${PARTITION_ID_PREFIX}_${generateTsid()}`);
  await partitionRepo.persist(
    Partition.create({ id: partitionId, clientId, code: 'P1', name: 'P1', now: new Date() }),
  );
  return partitionId;
}

async function persistPrincipal(repo: PrincipalRepository, name: string): Promise<PrincipalId> {
  const id = asPrincipalId(`prn_${generateTsid()}`);
  await repo.upsert({ id, principalType: 'USER', name, email: null });
  return id;
}

describe('PrincipalRepository (integration)', () => {
  let repo: PrincipalRepository;
  let clientRepo: ReturnType<typeof createDrizzleClientRepository>;
  let partitionRepo: ReturnType<typeof createDrizzlePartitionRepository>;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzlePrincipalRepository(db);
    clientRepo = createDrizzleClientRepository(db);
    partitionRepo = createDrizzlePartitionRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('upsert inserts then updates by id', async () => {
    const id = asPrincipalId(`prn_${generateTsid()}`);
    const first = await repo.upsert({ id, principalType: 'USER', name: 'Alice', email: null });
    expect(first.name).toBe('Alice');

    const second = await repo.upsert({
      id,
      principalType: 'USER',
      name: 'Alice Bob',
      email: 'alice@example.com',
    });
    expect(second.name).toBe('Alice Bob');
    expect(second.email).toBe('alice@example.com');

    const fetched = await repo.findById(id);
    expect(fetched?.name).toBe('Alice Bob');
    expect(fetched?.email).toBe('alice@example.com');
  });

  it('grant + list + revoke round-trip', async () => {
    const partitionId = await setupClientAndPartition(clientRepo, partitionRepo);
    const granter = await persistPrincipal(repo, 'Granter');
    const grantee = await persistPrincipal(repo, 'Grantee');

    await repo.grantPartitionAccess(grantee, partitionId, granter);

    const list = await repo.findPrincipalsForPartition(partitionId);
    expect(list).toHaveLength(1);
    expect(list[0]?.principal.id).toBe(grantee);
    expect(list[0]?.grantedAt).toBeInstanceOf(Date);

    const removed = await repo.revokePartitionAccess(grantee, partitionId);
    expect(removed).toBe(true);

    expect(await repo.findPrincipalsForPartition(partitionId)).toHaveLength(0);
  });

  it('grantPartitionAccess is idempotent (re-grant returns no extra row)', async () => {
    const partitionId = await setupClientAndPartition(clientRepo, partitionRepo);
    const granter = await persistPrincipal(repo, 'Granter');
    const grantee = await persistPrincipal(repo, 'Grantee');

    await repo.grantPartitionAccess(grantee, partitionId, granter);
    await repo.grantPartitionAccess(grantee, partitionId, granter);

    expect(await repo.findPrincipalsForPartition(partitionId)).toHaveLength(1);
  });

  it('revoke returns false when no grant exists', async () => {
    const partitionId = await setupClientAndPartition(clientRepo, partitionRepo);
    const ghost = await persistPrincipal(repo, 'Ghost');
    expect(await repo.revokePartitionAccess(ghost, partitionId)).toBe(false);
  });
});
