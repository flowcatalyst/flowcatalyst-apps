import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import type { SyncEventType } from '@fulfil-go/shared';
import { syncEvents, type SyncEventRow } from './schema/sync-events.js';

/** Per-principal SSE channel. One channel per user across all their devices. */
export function userChannel(principalId: string): string {
  return `user:${principalId}`;
}

/**
 * Per-store SSE channel — pick events fan out to every station/picker at the
 * store (a pick is store work, not one person's). Picker sessions subscribe
 * here (their scope carries clientId + storeRef attributes).
 */
export function storeChannel(clientId: string, storeRef: string): string {
  return `store:${clientId}:${storeRef}`;
}

export interface SyncEventRecord {
  readonly id: number;
  readonly channel: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly createdAt: Date;
}

export interface SyncEventRepository {
  /**
   * Append an event to a channel INSIDE the ambient use-case transaction
   * (TransactionStore ALS — required, so an append can never land outside a
   * `runWrite` boundary). If the surrounding commit fails, the append rolls
   * back with it: no phantom SSE events.
   */
  append(channel: string, eventType: SyncEventType, payload: unknown): Promise<void>;
  /** Replay rows after `afterId` for a channel, oldest first. */
  listAfter(channel: string, afterId: number, limit: number): Promise<readonly SyncEventRecord[]>;
  /** Highest event id on a channel (0 when the channel has no events yet). */
  latestId(channel: string): Promise<number>;
  /** Highest event id across all channels — the broker's poll high-water mark. */
  globalLatestId(): Promise<number>;
  /** Rows after `afterId` across ALL channels, oldest first — broker poll read. */
  listAllAfter(afterId: number, limit: number): Promise<readonly SyncEventRecord[]>;
}

function toRecord(row: SyncEventRow): SyncEventRecord {
  return {
    id: row.id,
    channel: row.channel,
    eventType: row.eventType,
    payload: row.payload,
    createdAt: row.createdAt,
  };
}

/**
 * Visibility horizon: only rows whose writing transaction precedes every
 * transaction still in flight. Sequence ids are allocated before commit, so
 * without this a row with a lower id can surface AFTER a higher id was read
 * and any cursor (broker high-water mark, a client's Last-Event-ID, the
 * delta-sync latestEventId) would skip it forever. Applied to EVERY read —
 * cursor-issuing queries included — so no id is ever exposed while a lower
 * one is still uncommitted. Cost: emission waits for the oldest in-flight
 * WRITE tx (read-only txs hold no xid), so keep write txs short — a
 * long-running backfill inside one tx stalls SSE delivery until it commits.
 */
const behindVisibilityHorizon = sql`${syncEvents.txid} < pg_snapshot_xmin(pg_current_snapshot())`;

export function createDrizzleSyncEventRepository(db: PostgresJsDatabase): SyncEventRepository {
  return {
    async append(channel, eventType, payload): Promise<void> {
      const tx = TransactionStore.require();
      const client = resolveDb(db, tx);
      await client.insert(syncEvents).values({ channel, eventType, payload });
    },

    async listAfter(channel, afterId, limit): Promise<readonly SyncEventRecord[]> {
      const rows = await db
        .select()
        .from(syncEvents)
        .where(
          and(eq(syncEvents.channel, channel), gt(syncEvents.id, afterId), behindVisibilityHorizon),
        )
        .orderBy(asc(syncEvents.id))
        .limit(limit);
      return rows.map(toRecord);
    },

    async latestId(channel): Promise<number> {
      const [row] = await db
        .select({ id: syncEvents.id })
        .from(syncEvents)
        .where(and(eq(syncEvents.channel, channel), behindVisibilityHorizon))
        .orderBy(desc(syncEvents.id))
        .limit(1);
      return row?.id ?? 0;
    },

    async globalLatestId(): Promise<number> {
      const [row] = await db
        .select({ id: syncEvents.id })
        .from(syncEvents)
        .where(behindVisibilityHorizon)
        .orderBy(desc(syncEvents.id))
        .limit(1);
      return row?.id ?? 0;
    },

    async listAllAfter(afterId, limit): Promise<readonly SyncEventRecord[]> {
      const rows = await db
        .select()
        .from(syncEvents)
        .where(and(gt(syncEvents.id, afterId), behindVisibilityHorizon))
        .orderBy(asc(syncEvents.id))
        .limit(limit);
      return rows.map(toRecord);
    },
  };
}
