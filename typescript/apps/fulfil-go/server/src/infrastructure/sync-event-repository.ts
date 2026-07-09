import { and, asc, desc, eq, gt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import type { SyncEventType } from '@fulfil-go/shared';
import { syncEvents, type SyncEventRow } from './schema/sync-events.js';

/** Per-principal SSE channel. One channel per user across all their devices. */
export function userChannel(principalId: string): string {
  return `user:${principalId}`;
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
        .where(and(eq(syncEvents.channel, channel), gt(syncEvents.id, afterId)))
        .orderBy(asc(syncEvents.id))
        .limit(limit);
      return rows.map(toRecord);
    },

    async latestId(channel): Promise<number> {
      const [row] = await db
        .select({ id: syncEvents.id })
        .from(syncEvents)
        .where(eq(syncEvents.channel, channel))
        .orderBy(desc(syncEvents.id))
        .limit(1);
      return row?.id ?? 0;
    },

    async globalLatestId(): Promise<number> {
      const [row] = await db
        .select({ id: syncEvents.id })
        .from(syncEvents)
        .orderBy(desc(syncEvents.id))
        .limit(1);
      return row?.id ?? 0;
    },

    async listAllAfter(afterId, limit): Promise<readonly SyncEventRecord[]> {
      const rows = await db
        .select()
        .from(syncEvents)
        .where(gt(syncEvents.id, afterId))
        .orderBy(asc(syncEvents.id))
        .limit(limit);
      return rows.map(toRecord);
    },
  };
}
