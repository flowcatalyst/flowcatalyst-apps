import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateTsid } from '@flowcatalyst/sdk';
import { asMasterLocationId, type MasterLocationId } from '../domain/locations/ids.js';
import type {
  ProcessingLogEntry,
  ProcessingLogRepository,
} from '../domain/locations/processing-log.repository.js';
import { processingLog, type ProcessingLogRow } from './schema/processing-log.js';

const PROCESSING_LOG_ID_PREFIX = 'plg';

function toDomain(row: ProcessingLogRow): ProcessingLogEntry {
  return {
    id: row.id,
    masterLocationId: asMasterLocationId(row.masterLocationId),
    step: row.step,
    data: (row.data ?? {}) as Readonly<Record<string, unknown>>,
    createdAt: row.createdAt,
  };
}

/**
 * Append-only processing-log driver. Writes are NOT wrapped in the UoW
 * — the Rust pinpoint deliberately fires-and-forgets these calls so a
 * logging failure can't take down the matching pipeline. Callers
 * `await` the promise but ignore errors (the use case sites `void`
 * the result).
 */
export function createDrizzleProcessingLogRepository(
  db: PostgresJsDatabase,
): ProcessingLogRepository {
  return {
    async append(
      masterLocationId: MasterLocationId,
      step: string,
      data: Readonly<Record<string, unknown>>,
    ): Promise<void> {
      await db.insert(processingLog).values({
        id: `${PROCESSING_LOG_ID_PREFIX}_${generateTsid()}`,
        masterLocationId,
        step,
        data,
      });
    },

    async listByMaster(masterLocationId: MasterLocationId): Promise<readonly ProcessingLogEntry[]> {
      const rows = await db
        .select()
        .from(processingLog)
        .where(eq(processingLog.masterLocationId, masterLocationId))
        .orderBy(asc(processingLog.createdAt));
      return rows.map(toDomain);
    },
  };
}
