import type { Sql } from 'postgres';

/**
 * Cross-node SSE nudge. An AFTER INSERT trigger on sync_events pg_notify()s
 * this channel; Postgres delivers NOTIFY on COMMIT, so every node's broker
 * wakes exactly when new rows become visible — no matter which node wrote.
 * The broker's poll interval stays on as the safety net (it also covers rows
 * whose visibility horizon opens without a fresh NOTIFY).
 */
export const SYNC_NOTIFY_CHANNEL = 'fulfilgo_sync';

interface NotifyLogger {
  warn: (obj: unknown, msg?: string) => void;
}

/**
 * LISTEN on a dedicated connection and invoke `onNotify` per notification.
 * postgres-js re-establishes the listener on connection loss; the onListen
 * callback fires on initial connect AND every reconnect, so nudging there
 * too covers notifications missed while disconnected. A LISTEN failure is
 * logged, not fatal — the broker's poll keeps multi-node delivery correct,
 * just at poll latency.
 *
 * Returns an async disposer (no-op when the listener never came up).
 */
export async function listenForSyncEvents(
  sql: Sql,
  onNotify: () => void,
  log: NotifyLogger,
): Promise<() => Promise<void>> {
  try {
    const { unlisten } = await sql.listen(SYNC_NOTIFY_CHANNEL, onNotify, onNotify);
    return unlisten;
  } catch (err) {
    log.warn(
      { err },
      `LISTEN ${SYNC_NOTIFY_CHANNEL} failed — SSE falls back to poll-only (multi-node delivery still correct, ~1s latency)`,
    );
    return async () => {};
  }
}
