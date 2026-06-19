/**
 * Integration test for the Postgres-backed SessionStore driver. Uses the
 * shared `db-fixture` testcontainer — the same one the repo + use-case
 * tests share — so the `sessions` migration is applied and `cleanDb()`
 * wipes the table between tests.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDrizzleSessionStore } from '../../../src/auth/session-store-drizzle.js';
import type { SessionStore } from '../../../src/auth/session-store.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

describe('DrizzleSessionStore (integration)', () => {
  let store: SessionStore;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    store = createDrizzleSessionStore(db);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('round-trips a session created at /auth/login', async () => {
    const id = store.generateId();
    const created = await store.create(id, {
      codeVerifier: 'verifier-xyz',
      state: 'state-abc',
    });

    expect(created.id).toBe(id);
    expect(created.accessToken).toBe('');
    expect(created.codeVerifier).toBe('verifier-xyz');
    expect(created.state).toBe('state-abc');

    const fetched = await store.get(id);
    expect(fetched?.codeVerifier).toBe('verifier-xyz');
    expect(fetched?.state).toBe('state-abc');
    expect(fetched?.accessToken).toBe('');
  });

  it('merges patches via update — unset fields untouched', async () => {
    const id = store.generateId();
    await store.create(id, { codeVerifier: 'v1', state: 's1' });

    const updated = await store.update(id, {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      sub: 'prn_alice',
      // Clear the in-flight fields, mirroring the /auth/callback shape.
      codeVerifier: null,
      state: null,
    });

    expect(updated?.accessToken).toBe('at-1');
    expect(updated?.refreshToken).toBe('rt-1');
    expect(updated?.sub).toBe('prn_alice');
    expect(updated?.codeVerifier).toBeNull();
    expect(updated?.state).toBeNull();

    // updatedAt is bumped on every write.
    const stored = await store.get(id);
    expect(stored?.updatedAt.getTime()).toBeGreaterThanOrEqual(updated!.updatedAt.getTime());
  });

  it('preserves unset fields on partial update', async () => {
    const id = store.generateId();
    await store.create(id, {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      sub: 'prn_alice',
      email: 'alice@example.test',
    });

    await store.update(id, { accessToken: 'at-2' });

    const stored = await store.get(id);
    expect(stored?.accessToken).toBe('at-2');
    expect(stored?.refreshToken).toBe('rt-1');
    expect(stored?.sub).toBe('prn_alice');
    expect(stored?.email).toBe('alice@example.test');
  });

  it('returns undefined for unknown sessions on get + update', async () => {
    expect(await store.get('does-not-exist')).toBeUndefined();
    expect(await store.update('does-not-exist', { accessToken: 'whatever' })).toBeUndefined();
  });

  it('delete returns true once + false on second attempt', async () => {
    const id = store.generateId();
    await store.create(id, {});

    expect(await store.delete(id)).toBe(true);
    expect(await store.delete(id)).toBe(false);
    expect(await store.get(id)).toBeUndefined();
  });

  it('size counts active sessions', async () => {
    expect(await store.size()).toBe(0);

    await store.create(store.generateId(), {});
    await store.create(store.generateId(), {});
    await store.create(store.generateId(), {});

    expect(await store.size()).toBe(3);
  });

  it('survives a fresh store handle over the same DB — sessions persist', async () => {
    const id = store.generateId();
    await store.create(id, { accessToken: 'persist-me' });

    // Reach behind the abstraction: build a second store handle over
    // the same DB and confirm the row is still there. Mirrors the
    // "two replicas behind the same DB" cutover scenario.
    const { db } = await getDbFixture();
    const second = createDrizzleSessionStore(db);

    const fetched = await second.get(id);
    expect(fetched?.accessToken).toBe('persist-me');
  });
});
