import { asc, eq } from 'drizzle-orm';
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
  };
}
