import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../http/api-client.js';
import { createMemoryQueueStorage } from './storage-memory.js';
import { createOfflineQueue } from './offline-queue.js';

function fakeApi(responder: (path: string) => Promise<Response>): ApiClient {
  return {
    baseUrl: 'http://test',
    authHeaders: async () => ({}),
    request: async (path) => responder(path),
    json: async () => {
      throw new Error('unused');
    },
  };
}

describe('createOfflineQueue', () => {
  it('delivers a queued item with an Idempotency-Key and removes it on 2xx', async () => {
    const storage = createMemoryQueueStorage();
    const responder = vi.fn(async () => new Response('{}', { status: 200 }));
    const queue = createOfflineQueue({ storage, api: fakeApi(responder) });

    await queue.enqueue({ endpoint: '/jobs/j1/accept', body: {} });
    await queue.flush();

    expect(responder).toHaveBeenCalledTimes(1);
    expect(await queue.counts()).toEqual({ pending: 0, dead: 0 });
  });

  it('backs off and retries on 5xx, keeping the item pending', async () => {
    const storage = createMemoryQueueStorage();
    const queue = createOfflineQueue({
      storage,
      api: fakeApi(async () => new Response('boom', { status: 500 })),
    });

    await queue.enqueue({ endpoint: '/jobs/j1/accept' });
    await queue.flush();

    const counts = await queue.counts();
    expect(counts.pending).toBe(1);
    // Not due yet — a second flush must not re-deliver immediately.
    const due = await storage.listDue(Date.now(), 10);
    expect(due).toHaveLength(0);
  });

  it('dead-letters on a non-retryable 4xx', async () => {
    const storage = createMemoryQueueStorage();
    const queue = createOfflineQueue({
      storage,
      api: fakeApi(async () => new Response('{"code":"JOB_NOT_YOURS"}', { status: 422 })),
    });

    await queue.enqueue({ endpoint: '/jobs/j1/accept' });
    await queue.flush();

    expect(await queue.counts()).toEqual({ pending: 0, dead: 1 });
    const [dead] = await queue.listDead();
    expect(dead?.lastError).toContain('422');
  });

  it('retries a network error and succeeds on the next flush', async () => {
    const storage = createMemoryQueueStorage();
    let calls = 0;
    const queue = createOfflineQueue({
      storage,
      api: fakeApi(async () => {
        calls += 1;
        if (calls === 1) throw new Error('offline');
        return new Response('{}', { status: 200 });
      }),
    });

    await queue.enqueue({ endpoint: '/jobs/j1/complete', body: { note: 'x' } });
    await queue.flush();
    expect(await queue.counts()).toEqual({ pending: 1, dead: 0 });

    // Force the item due now, as a network-regain flush would find it later.
    const [item] = await queue.listDead();
    expect(item).toBeUndefined();
    const [pending] = await storage.listDue(Date.now() + 60_000, 10);
    expect(pending).toBeDefined();
    await storage.update({ ...pending!, nextAttemptAt: Date.now() });
    await queue.flush();

    expect(await queue.counts()).toEqual({ pending: 0, dead: 0 });
  });

  it('retryDead re-arms a dead item', async () => {
    const storage = createMemoryQueueStorage();
    let fail = true;
    const queue = createOfflineQueue({
      storage,
      api: fakeApi(async () =>
        fail ? new Response('nope', { status: 400 }) : new Response('{}', { status: 200 }),
      ),
    });

    await queue.enqueue({ endpoint: '/jobs/j1/accept' });
    await queue.flush();
    expect((await queue.counts()).dead).toBe(1);

    fail = false;
    const [dead] = await queue.listDead();
    await queue.retryDead(dead!.id);
    await queue.flush();
    expect(await queue.counts()).toEqual({ pending: 0, dead: 0 });
  });
});
