import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import {
  fulfilmentProcessingLog,
  type FulfilmentLogRow,
} from './schema/fulfilment-processing-log.js';

export interface FulfilmentLogEntry {
  readonly clientId: string;
  readonly fulfilmentId: string;
  readonly actor: string;
  readonly category: string;
  readonly message: string;
  readonly data?: unknown;
}

export interface FulfilmentProcessingLogRepository {
  /**
   * Append INSIDE the ambient use-case transaction (TransactionStore —
   * required): a rolled-back command never leaves a phantom log entry.
   */
  append(entry: FulfilmentLogEntry): Promise<void>;
  list(fulfilmentId: string): Promise<readonly FulfilmentLogRow[]>;
  /**
   * State-guard read for process-manager deciders with no aggregate
   * transition to lean on (e.g. the EPOD provisioning dispatch marker) —
   * joins the ambient tx so guard + append + outbox commit atomically.
   * The ONLY sanctioned decision-making read of this log.
   */
  hasEntry(fulfilmentId: string, category: string): Promise<boolean>;
}

export function createDrizzleFulfilmentProcessingLogRepository(
  db: PostgresJsDatabase,
): FulfilmentProcessingLogRepository {
  return {
    async append(entry): Promise<void> {
      const tx = TransactionStore.require();
      const client = resolveDb(db, tx);
      await client.insert(fulfilmentProcessingLog).values({
        clientId: entry.clientId,
        fulfilmentId: entry.fulfilmentId,
        actor: entry.actor,
        category: entry.category,
        message: entry.message,
        data: entry.data ?? null,
      });
    },

    async list(fulfilmentId): Promise<readonly FulfilmentLogRow[]> {
      return db
        .select()
        .from(fulfilmentProcessingLog)
        .where(eq(fulfilmentProcessingLog.fulfilmentId, fulfilmentId))
        .orderBy(asc(fulfilmentProcessingLog.id));
    },

    async hasEntry(fulfilmentId, category): Promise<boolean> {
      const client = resolveDb(db, TransactionStore.get());
      const rows = await client
        .select({ id: fulfilmentProcessingLog.id })
        .from(fulfilmentProcessingLog)
        .where(
          and(
            eq(fulfilmentProcessingLog.fulfilmentId, fulfilmentId),
            eq(fulfilmentProcessingLog.category, category),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}
