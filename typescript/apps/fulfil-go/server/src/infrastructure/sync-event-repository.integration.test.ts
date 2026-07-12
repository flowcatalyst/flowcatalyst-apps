import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDrizzleSyncEventRepository } from './sync-event-repository.js';

/**
 * Integration tests for the sync_events visibility horizon + NOTIFY trigger.
 * They need a real Postgres with migrations applied (dev loop: fc-dev's
 * embedded PG + `pnpm db:migrate`), so the suite is env-gated:
 *
 *   DATABASE_URL=postgresql://… pnpm test
 *
 * Without the env the suite skips — unit-test runs stay DB-free.
 */
const DB_URL = process.env['FULFILGO_TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];

function testChannel(): string {
  return `test:horizon:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Poll `fn` until truthy or timeout — absorbs unrelated concurrent write txs. */
async function eventually<T>(fn: () => Promise<T>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!DB_URL)('sync_events visibility horizon (integration)', () => {
  const pool = postgres(DB_URL ?? '', { max: 3, onnotice: () => {} });
  const repo = createDrizzleSyncEventRepository(drizzle({ client: pool }));
  const channels: string[] = [];

  afterAll(async () => {
    for (const channel of channels) {
      await pool`DELETE FROM sync_events WHERE channel = ${channel}`;
    }
    await pool.end();
  });

  it('never exposes a committed higher id while a lower id is still in flight', async () => {
    const channel = testChannel();
    channels.push(channel);

    // Tx A inserts first (lower id + lower txid) and stays OPEN.
    let commitA!: () => void;
    let insertedA!: () => Promise<void>;
    const aInserted = new Promise<void>((r) => (insertedA = r as () => Promise<void>));
    const aDone = pool.begin(async (tx) => {
      await tx`INSERT INTO sync_events (channel, event_type, payload)
               VALUES (${channel}, 'test', '{"n":1}'::jsonb)`;
      (insertedA as unknown as () => void)();
      await new Promise<void>((r) => (commitA = r));
    });
    await aInserted;

    // Tx B inserts AFTER A (higher id) and commits immediately.
    await pool`INSERT INTO sync_events (channel, event_type, payload)
               VALUES (${channel}, 'test', '{"n":2}'::jsonb)`;

    // B is committed and visible to a plain SELECT — but it must be hidden
    // behind the horizon, or a cursor would advance past A forever.
    expect(await repo.listAfter(channel, 0, 10)).toHaveLength(0);
    expect(await repo.latestId(channel)).toBe(0);

    commitA();
    await aDone;

    // Horizon opens once A commits: both rows surface, in id order.
    const rows = await eventually(async () => {
      const r = await repo.listAfter(channel, 0, 10);
      return r.length === 2 ? r : null;
    });
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => (r.payload as { n: number }).n)).toEqual([1, 2]);
    expect(rows![0]!.id).toBeLessThan(rows![1]!.id);
    expect(await repo.latestId(channel)).toBe(rows![1]!.id);
  });

  it('NOTIFYs fulfilgo_sync on insert commit (multi-node broker nudge)', async () => {
    const channel = testChannel();
    channels.push(channel);

    let notified!: () => void;
    const gotNotify = new Promise<void>((r) => (notified = r));
    const { unlisten } = await pool.listen('fulfilgo_sync', () => notified());

    await pool`INSERT INTO sync_events (channel, event_type, payload)
               VALUES (${channel}, 'test', '{}'::jsonb)`;

    await expect(
      Promise.race([
        gotNotify,
        new Promise((_, reject) => setTimeout(() => reject(new Error('no NOTIFY in 2s')), 2_000)),
      ]),
    ).resolves.toBeUndefined();
    await unlisten();
  });
});
