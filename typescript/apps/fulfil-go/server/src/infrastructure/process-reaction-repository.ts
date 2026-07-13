import { and, asc, eq, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import { brandedTsid } from '@fulfil-go/framework';
import { processReactions, type ProcessReactionRow } from './schema/transport-orders.js';

/**
 * Timed process reactions — bookkeeping for "do X for this fulfilment at
 * time T" (the LastMileFulfilment pattern; docs/transport-context.md). The
 * process manager schedules; the platform-cron sweep releases due rows.
 * Reference data semantics: idempotent schedule (unique kind+fulfilment),
 * status marches pending → done | cancelled.
 */
export interface ProcessReaction {
  readonly id: string;
  readonly clientId: string;
  readonly fulfilmentId: string;
  readonly kind: string;
  readonly dueAt: Date;
  readonly status: string;
  readonly payload: unknown;
}

export interface ProcessReactionRepository {
  /**
   * Schedule (same-tx with the deciding webhook): returns false when the
   * reaction already exists — replays converge without error.
   */
  schedule(reaction: {
    clientId: string;
    fulfilmentId: string;
    kind: string;
    dueAt: Date;
    payload?: unknown;
  }): Promise<boolean>;
  /** Due pending reactions, oldest first — the sweep's work list. */
  listDue(now: Date, limit: number): Promise<readonly ProcessReaction[]>;
  /** Transition pending → done; false when someone else got there first. */
  markDone(id: string): Promise<boolean>;
  /** Cancel a pending reaction (e.g. the fulfilment failed before dueAt). */
  cancel(kind: string, fulfilmentId: string): Promise<boolean>;
}

function toDomain(row: ProcessReactionRow): ProcessReaction {
  return {
    id: row.id,
    clientId: row.clientId,
    fulfilmentId: row.fulfilmentId,
    kind: row.kind,
    dueAt: row.dueAt,
    status: row.status,
    payload: row.payload,
  };
}

export function createDrizzleProcessReactionRepository(
  db: PostgresJsDatabase,
): ProcessReactionRepository {
  const current = () => resolveDb(db, TransactionStore.get());
  return {
    async schedule(reaction): Promise<boolean> {
      const rows = await current()
        .insert(processReactions)
        .values({
          id: brandedTsid('rct'),
          clientId: reaction.clientId,
          fulfilmentId: reaction.fulfilmentId,
          kind: reaction.kind,
          dueAt: reaction.dueAt,
          payload: reaction.payload ?? null,
        })
        .onConflictDoNothing({
          target: [processReactions.kind, processReactions.fulfilmentId],
        })
        .returning({ id: processReactions.id });
      return rows.length > 0;
    },

    async listDue(now, limit): Promise<readonly ProcessReaction[]> {
      const rows = await current()
        .select()
        .from(processReactions)
        .where(and(eq(processReactions.status, 'pending'), lte(processReactions.dueAt, now)))
        .orderBy(asc(processReactions.dueAt))
        .limit(limit);
      return rows.map(toDomain);
    },

    async markDone(id): Promise<boolean> {
      const rows = await current()
        .update(processReactions)
        .set({ status: 'done', updatedAt: new Date() })
        .where(and(eq(processReactions.id, id), eq(processReactions.status, 'pending')))
        .returning({ id: processReactions.id });
      return rows.length > 0;
    },

    async cancel(kind, fulfilmentId): Promise<boolean> {
      const rows = await current()
        .update(processReactions)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(processReactions.kind, kind),
            eq(processReactions.fulfilmentId, fulfilmentId),
            eq(processReactions.status, 'pending'),
          ),
        )
        .returning({ id: processReactions.id });
      return rows.length > 0;
    },
  };
}
