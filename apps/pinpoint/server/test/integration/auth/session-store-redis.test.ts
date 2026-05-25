/**
 * Integration test for the Redis-backed SessionStore driver. Uses a
 * Redis 7 testcontainer (see `./redis-fixture.ts`).
 *
 * Mirrors the Drizzle driver test suite — same scenarios, different
 * driver. The deliberate one-to-one mapping makes it easy to spot if
 * one driver diverges from the other's semantics.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRedisSessionStore } from '../../../src/auth/session-store-redis.js';
import type { SessionStore } from '../../../src/auth/session-store.js';
import { flushRedis, getRedisFixture } from './redis-fixture.js';

describe('RedisSessionStore (integration)', () => {
  let store: SessionStore;

  beforeAll(async () => {
    const { client } = await getRedisFixture();
    store = createRedisSessionStore({ client });
  });

  beforeEach(async () => {
    await flushRedis();
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

    const fetched = await store.get(id);
    expect(fetched?.codeVerifier).toBe('verifier-xyz');
    expect(fetched?.state).toBe('state-abc');
    // Date round-trips via ISO string.
    expect(fetched?.createdAt).toBeInstanceOf(Date);
  });

  it('merges patches via update — unset fields untouched', async () => {
    const id = store.generateId();
    await store.create(id, { codeVerifier: 'v1', state: 's1' });

    const updated = await store.update(id, {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      sub: 'prn_alice',
      codeVerifier: null,
      state: null,
    });

    expect(updated?.accessToken).toBe('at-1');
    expect(updated?.codeVerifier).toBeNull();

    const stored = await store.get(id);
    expect(stored?.sub).toBe('prn_alice');
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

  it('size counts active sessions via SCAN (not the global DBSIZE)', async () => {
    expect(await store.size()).toBe(0);

    await store.create(store.generateId(), {});
    await store.create(store.generateId(), {});
    await store.create(store.generateId(), {});

    expect(await store.size()).toBe(3);
  });

  it('prefix isolates session keys from other consumers', async () => {
    const { client } = await getRedisFixture();
    const isolatedStore = createRedisSessionStore({ client, prefix: 'isolated:session:' });

    // Put a key under a *different* prefix — should not show up in size().
    await client.set('other:cache:something', 'unrelated');

    await isolatedStore.create(isolatedStore.generateId(), {});
    await isolatedStore.create(isolatedStore.generateId(), {});

    expect(await isolatedStore.size()).toBe(2);
  });

  it('survives a fresh store handle over the same Redis — sessions persist', async () => {
    const id = store.generateId();
    await store.create(id, { accessToken: 'persist-me' });

    const { client } = await getRedisFixture();
    const second = createRedisSessionStore({ client });

    const fetched = await second.get(id);
    expect(fetched?.accessToken).toBe('persist-me');
  });
});
