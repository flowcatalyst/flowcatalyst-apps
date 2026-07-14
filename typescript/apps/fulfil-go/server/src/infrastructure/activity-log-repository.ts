import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import { activityLog, type ActivityLogRow } from './schema/activity-log.js';

/** What kind of thing the entry is about (docs/activity-log.md). */
export type ActivitySubjectType = 'fulfilment' | 'part' | 'pick' | 'transport_order' | 'trip';

/** Which system produced the entry. */
export type ActivitySource = 'domain' | 'platform' | 'uber' | 'epod' | 'admin';

export interface ActivityLogEntry {
  readonly clientId: string;
  /** Root chain correlation; null only for entries with no fulfilment chain. */
  readonly fulfilmentId: string | null;
  readonly subjectType: ActivitySubjectType;
  readonly subjectId: string;
  readonly category: string;
  readonly source: ActivitySource;
  readonly actor: string;
  readonly message: string;
  readonly data?: unknown;
}

export interface ActivityLogRepository {
  /**
   * Append INSIDE the ambient use-case transaction (TransactionStore —
   * required): a rolled-back command never leaves a phantom log entry.
   * For DOMAIN writes only.
   */
  append(entry: ActivityLogEntry): Promise<void>;
  /**
   * Best-effort append OUTSIDE any transaction (pool write) — for external
   * interactions with no shared tx (provider calls, webhook receipts,
   * ACKed-but-ignored replays). NEVER throws: losing a log line must not
   * fail the interaction it describes.
   */
  appendDetached(entry: ActivityLogEntry): Promise<void>;
  listByFulfilment(fulfilmentId: string): Promise<readonly ActivityLogRow[]>;
  listBySubject(
    subjectType: ActivitySubjectType,
    subjectId: string,
  ): Promise<readonly ActivityLogRow[]>;
  /**
   * State-guard read for process-manager deciders with no aggregate
   * transition to lean on (e.g. the EPOD provisioning dispatch marker) —
   * joins the ambient tx so guard + append + outbox commit atomically.
   * The ONLY sanctioned decision-making read of this log.
   */
  hasEntry(fulfilmentId: string, category: string): Promise<boolean>;
  /**
   * Audit-BEFORE-disclose append (docs/handover-verification.md): a plain
   * pool write that THROWS on failure — callers revealing secrets must not
   * return them when the audit record could not be written.
   */
  appendAudited(entry: ActivityLogEntry): Promise<void>;
}

interface ActivityLogLogger {
  error(obj: unknown, msg: string): void;
}

export function createDrizzleActivityLogRepository(
  db: PostgresJsDatabase,
  logger: ActivityLogLogger = console,
): ActivityLogRepository {
  const toRow = (entry: ActivityLogEntry) => ({
    clientId: entry.clientId,
    fulfilmentId: entry.fulfilmentId,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    actor: entry.actor,
    category: entry.category,
    source: entry.source,
    message: entry.message,
    data: entry.data ?? null,
  });

  return {
    async append(entry): Promise<void> {
      const tx = TransactionStore.require();
      const client = resolveDb(db, tx);
      await client.insert(activityLog).values(toRow(entry));
    },

    async appendDetached(entry): Promise<void> {
      try {
        await db.insert(activityLog).values(toRow(entry));
      } catch (err) {
        logger.error({ err, entry }, 'activity-log detached append failed (entry lost)');
      }
    },

    async appendAudited(entry): Promise<void> {
      await db.insert(activityLog).values(toRow(entry));
    },

    async listByFulfilment(fulfilmentId): Promise<readonly ActivityLogRow[]> {
      return db
        .select()
        .from(activityLog)
        .where(eq(activityLog.fulfilmentId, fulfilmentId))
        .orderBy(asc(activityLog.id));
    },

    async listBySubject(subjectType, subjectId): Promise<readonly ActivityLogRow[]> {
      return db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.subjectType, subjectType), eq(activityLog.subjectId, subjectId)))
        .orderBy(asc(activityLog.id));
    },

    async hasEntry(fulfilmentId, category): Promise<boolean> {
      const client = resolveDb(db, TransactionStore.get());
      const rows = await client
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(and(eq(activityLog.fulfilmentId, fulfilmentId), eq(activityLog.category, category)))
        .limit(1);
      return rows.length > 0;
    },
  };
}
