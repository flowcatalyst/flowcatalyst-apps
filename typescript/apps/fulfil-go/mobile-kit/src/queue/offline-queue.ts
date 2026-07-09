import type { ApiClient } from '../http/api-client.js';
import type { QueueCounts, QueueItem, QueueStorage } from './queue-storage.js';

export interface EnqueueInput {
  readonly endpoint: string;
  readonly method?: string;
  readonly body?: unknown;
}

export interface OfflineQueue {
  /** Persist a mutation and try to flush immediately. */
  enqueue(input: EnqueueInput): Promise<void>;
  /** Drain due items now (network regain / app resume / manual retry). */
  flush(): Promise<void>;
  counts(): Promise<QueueCounts>;
  listDead(): Promise<readonly QueueItem[]>;
  /** Re-arm a dead item for another attempt. */
  retryDead(id: string): Promise<void>;
  discardDead(id: string): Promise<void>;
  /** Subscribe to queue mutations (for UI badges). Returns unsubscribe. */
  onChange(listener: () => void): () => void;
}

export interface OfflineQueueOptions {
  readonly storage: QueueStorage;
  readonly api: ApiClient;
  /** Max delivery attempts before an item is parked as dead. Default 8. */
  readonly maxAttempts?: number;
}

const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;
const FLUSH_BATCH = 20;

/**
 * Client-side outbox for mobile mutations. Every item carries a generated
 * Idempotency-Key, so at-least-once delivery is safe: the server replays the
 * stored response for keys it has seen.
 *
 * Outcome handling: 2xx → done; 429 / 5xx / network error → exponential
 * backoff retry; any other 4xx → dead-letter (the request is structurally
 * wrong or the business rule finally rejected it — retrying can't fix it,
 * a human decides via the dead-letter UI).
 */
export function createOfflineQueue(options: OfflineQueueOptions): OfflineQueue {
  const { storage, api } = options;
  const maxAttempts = options.maxAttempts ?? 8;
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function retryDelay(attempts: number): number {
    return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** attempts);
  }

  async function deliver(item: QueueItem): Promise<void> {
    let outcome: 'done' | 'retry' | 'dead';
    let lastError: string | null = null;
    try {
      const res = await api.request(item.endpoint, {
        method: item.method,
        ...(item.body !== null ? { body: JSON.parse(item.body) as unknown } : {}),
        headers: { 'idempotency-key': item.idempotencyKey },
      });
      if (res.ok) {
        outcome = 'done';
      } else if (res.status === 429 || res.status >= 500) {
        outcome = 'retry';
        lastError = `HTTP ${res.status}`;
      } else {
        outcome = 'dead';
        lastError = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 500)}`;
      }
    } catch (err) {
      outcome = 'retry';
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (outcome === 'done') {
      await storage.remove(item.id);
      return;
    }
    const attempts = item.attempts + 1;
    if (outcome === 'dead' || attempts >= maxAttempts) {
      await storage.update({ ...item, attempts, status: 'dead', lastError });
      return;
    }
    await storage.update({
      ...item,
      attempts,
      nextAttemptAt: Date.now() + retryDelay(attempts),
      lastError,
    });
  }

  async function doFlush(): Promise<void> {
    for (;;) {
      const due = await storage.listDue(Date.now(), FLUSH_BATCH);
      if (due.length === 0) break;
      for (const item of due) {
        await deliver(item);
      }
      notify();
      if (due.length < FLUSH_BATCH) break;
    }
  }

  // Concurrent callers join the in-flight drain instead of racing it — an
  // `await queue.flush()` right after `enqueue()` observes the completed run.
  function flush(): Promise<void> {
    inFlight ??= doFlush().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    async enqueue(input): Promise<void> {
      const now = Date.now();
      await storage.insert({
        id: crypto.randomUUID(),
        endpoint: input.endpoint,
        method: input.method ?? 'POST',
        body: input.body !== undefined ? JSON.stringify(input.body) : null,
        idempotencyKey: crypto.randomUUID(),
        attempts: 0,
        nextAttemptAt: now,
        status: 'pending',
        lastError: null,
        createdAt: now,
      });
      notify();
      void flush();
    },

    flush,

    counts: () => storage.counts(),
    listDead: () => storage.listDead(),

    async retryDead(id): Promise<void> {
      const dead = await storage.listDead();
      const item = dead.find((i) => i.id === id);
      if (!item) return;
      await storage.update({
        ...item,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
      });
      notify();
      void flush();
    },

    async discardDead(id): Promise<void> {
      await storage.remove(id);
      notify();
    },

    onChange(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
