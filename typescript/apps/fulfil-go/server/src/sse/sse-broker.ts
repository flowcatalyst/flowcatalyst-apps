import type {
  SyncEventRecord,
  SyncEventRepository,
} from '../infrastructure/sync-event-repository.js';

/**
 * In-process SSE broker for a single server instance.
 *
 * Delivery model: use cases append rows to `sync_events` inside the write tx;
 * this broker tails that table from a high-water mark and fans records out to
 * in-memory subscribers. The tail is driven two ways:
 *   - `nudge()` — called by routes after a successful write (best-effort,
 *     low latency), and
 *   - a poll interval (~1s) as the safety net (covers nudges lost to races
 *     and writes from other code paths).
 *
 * THE SCALE SEAM: for multi-instance deployment, only the trigger changes —
 * replace the poll/nudge pair with Postgres LISTEN/NOTIFY (`pg_notify` from
 * a post-commit hook or trigger on sync_events, `LISTEN fulfilgo_sync` here).
 * Replay stays table-backed either way; subscribers and frame delivery are
 * untouched.
 */
export interface SseBroker {
  /** Register a live listener for a channel. Returns the unsubscribe fn. */
  subscribe(channel: string, onEvent: (record: SyncEventRecord) => void): () => void;
  /** Wake the tail loop now instead of waiting for the next poll tick. */
  nudge(): void;
  start(): void;
  stop(): Promise<void>;
}

interface BrokerLogger {
  error: (obj: unknown, msg?: string) => void;
}

const POLL_INTERVAL_MS = 1_000;
const BATCH_LIMIT = 500;

export function createSseBroker(repo: SyncEventRepository, log: BrokerLogger): SseBroker {
  const subscribers = new Map<string, Set<(record: SyncEventRecord) => void>>();
  let highWaterMark = 0;
  let running = false;
  let wake: (() => void) | null = null;
  let loopDone: Promise<void> = Promise.resolve();

  function dispatch(record: SyncEventRecord): void {
    const channelSubs = subscribers.get(record.channel);
    if (!channelSubs) return;
    for (const onEvent of channelSubs) {
      try {
        onEvent(record);
      } catch (err) {
        log.error({ err, channel: record.channel }, 'sse subscriber threw; dropping event');
      }
    }
  }

  async function drain(): Promise<void> {
    // Loop until a read comes back short — a burst larger than BATCH_LIMIT
    // is delivered across consecutive reads without waiting for a poll tick.
    for (;;) {
      const records = await repo.listAllAfter(highWaterMark, BATCH_LIMIT);
      for (const record of records) {
        highWaterMark = record.id;
        dispatch(record);
      }
      if (records.length < BATCH_LIMIT) return;
    }
  }

  async function loop(): Promise<void> {
    highWaterMark = await repo.globalLatestId();
    for (;;) {
      if (!running) return;
      try {
        await drain();
      } catch (err) {
        log.error({ err }, 'sse broker drain failed; retrying on next tick');
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, POLL_INTERVAL_MS);
      });
      wake = null;
    }
  }

  return {
    subscribe(channel, onEvent) {
      let set = subscribers.get(channel);
      if (!set) {
        set = new Set();
        subscribers.set(channel, set);
      }
      set.add(onEvent);
      return () => {
        set.delete(onEvent);
        if (set.size === 0) subscribers.delete(channel);
      };
    },

    nudge() {
      wake?.();
    },

    start() {
      if (running) return;
      running = true;
      loopDone = loop().catch((err) => {
        log.error({ err }, 'sse broker loop crashed');
      });
    },

    async stop() {
      running = false;
      wake?.();
      await loopDone;
    },
  };
}
