/**
 * Integration test for the Drizzle ClientRepository — uses a real PG
 * testcontainer with all migrations applied (see ../db-fixture.ts).
 *
 * Demonstrates the pattern that the rest of the repo tests follow:
 *   - getDbFixture() once at suite start
 *   - cleanDb() in beforeEach so tests don't bleed state
 *   - Direct repo calls (no UoW / use-case wrapping) — repo tests
 *     verify the Drizzle layer; the UoW + scope wiring is covered by
 *     the use-case integration tests.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '../../../src/domain/tenancy/client.js';
import { asClientId, CLIENT_ID_PREFIX } from '../../../src/domain/tenancy/ids.js';
import { generateTsid } from '@flowcatalyst/sdk';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import type { ClientRepository } from '../../../src/domain/tenancy/client.repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

function newClient(overrides: Partial<{ name: string; code: string }> = {}) {
  return Client.create({
    id: asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`),
    name: overrides.name ?? 'Acme',
    code: overrides.code ?? 'ACME',
    now: new Date(),
  });
}

describe('ClientRepository (integration)', () => {
  let repo: ClientRepository;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzleClientRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('persists a client and reads it back', async () => {
    const client = newClient();
    const persisted = await repo.persist(client);

    expect(persisted.id).toBe(client.id);
    expect(persisted.name).toBe('Acme');
    expect(persisted.code).toBe('ACME');
    expect(persisted.status).toBe('ACTIVE');

    const fetched = await repo.findById(client.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.code).toBe('ACME');
  });

  it('upserts on persist of an existing id', async () => {
    const client = newClient();
    await repo.persist(client);

    const renamed = Client.rename(client, 'Acme Holdings', new Date());
    await repo.persist(renamed);

    const fetched = await repo.findById(client.id);
    expect(fetched?.name).toBe('Acme Holdings');
    // updatedAt should advance; createdAt should stay stable
    expect(fetched?.updatedAt.getTime()).toBeGreaterThanOrEqual(client.updatedAt.getTime());
  });

  it('findByCode resolves the same row as findById', async () => {
    const client = newClient({ code: 'GLOBEX' });
    await repo.persist(client);

    const byCode = await repo.findByCode('GLOBEX');
    expect(byCode?.id).toBe(client.id);
  });

  it('listAll paginates + reports total', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.persist(newClient({ code: `C${i}`, name: `Client ${i}` }));
    }

    const page = await repo.listAll({ limit: 2, offset: 1 });
    expect(page.total).toBe(5);
    expect(page.clients).toHaveLength(2);
  });

  it('delete removes the row', async () => {
    const client = newClient();
    await repo.persist(client);

    const removed = await repo.delete(client);
    expect(removed).toBe(true);

    expect(await repo.findById(client.id)).toBeNull();
  });

  it('delete returns false when nothing was deleted', async () => {
    const ghost = newClient();
    expect(await repo.delete(ghost)).toBe(false);
  });

  it('count tracks insertions', async () => {
    expect(await repo.count()).toBe(0);
    await repo.persist(newClient({ code: 'A' }));
    await repo.persist(newClient({ code: 'B' }));
    expect(await repo.count()).toBe(2);
  });
});
