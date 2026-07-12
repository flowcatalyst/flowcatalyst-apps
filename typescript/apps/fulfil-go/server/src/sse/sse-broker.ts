import type {
  SyncEventRecord,
  SyncEventRepository,
} from '../infrastructure/sync-event-repository.js';

/**
 * In-process SSE broker — one per server instance; multi-instance safe.
 *
 * Delivery model: use cases append rows to `sync_events` inside the write tx;
 * this broker tails that table from a high-water mark and fans records out to
 * in-memory subscribers. The tail is driven three ways:
 *   - `nudge()` — called by routes after a successful local write, and by the
 *     LISTEN fulfilgo_sync handler (wired in server.ts via sync-notify.ts):
 *     the sync_events insert trigger NOTIFYs on commit, so writes on ANY
 *     node wake every node's broker at low latency, and
 *   - a poll interval (~1s) as the safety net (covers a dropped listener
 *     connection and rows whose visibility horizon opens without a fresh
 *     NOTIFY).
 *
 * Multi-instance correctness: rows live in shared Postgres, every read is
 * guarded by the visibility horizon (see sync-event-repository — a row with
 * a lower id can never surface behind an already-advanced cursor), and
 * clients resume via Last-Event-ID — so any node can serve any SSE
 * connection, no sticky sessions.
 */
/** Wildcard channel: receives EVERY record (consumer filters). Used by the
 *  ops/flightboard stream, which spans all of a client's store channels. */
export const ALL_CHANNELS = '*';

export interface SseBroker {
  /** Register a live listener for a channel (or ALL_CHANNELS). Returns the unsubscribe fn. */
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
    for (const set of [subscribers.get(record.channel), subscribers.get(ALL_CHANNELS)]) {
      if (!set) continue;
      for (const onEvent of set) {
        try {
          onEvent(record);
        } catch (err) {
          log.error({ err, channel: record.channel }, 'sse subscriber threw; dropping event');
        }
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
    // Bootstrap retries inside the loop — a transient DB error here (e.g. a
    // pending migration) must degrade to retrying ticks, not kill SSE for
    // the process lifetime.
    let bootstrapped = false;
    for (;;) {
      if (!running) return;
      try {
        if (!bootstrapped) {
          highWaterMark = await repo.globalLatestId();
          bootstrapped = true;
        }
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
