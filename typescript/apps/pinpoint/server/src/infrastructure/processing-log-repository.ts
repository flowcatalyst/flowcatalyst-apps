import { asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateTsid } from '@flowcatalyst/sdk';
import { TransactionStore } from '@flowcatalyst-apps/app-framework';
import { asLocationId, asMasterLocationId } from '../domain/locations/ids.js';
import type {
  ProcessingLogEntry,
  ProcessingLogRepository,
  ProcessingLogSubject,
  ProcessingStep,
} from '../domain/locations/processing-log.repository.js';
import { processingLog, type ProcessingLogRow } from './schema/processing-log.js';

const PROCESSING_LOG_ID_PREFIX = 'plg';

function toDomain(row: ProcessingLogRow): ProcessingLogEntry {
  return {
    id: row.id,
    masterLocationId: row.masterLocationId ? asMasterLocationId(row.masterLocationId) : null,
    locationId: row.locationId ? asLocationId(row.locationId) : null,
    step: row.step,
    data: (row.data ?? {}) as Readonly<Record<string, unknown>>,
    createdAt: row.createdAt,
  };
}

/**
 * Append-only processing-log driver. Callers treat writes as
 * fire-and-forget — the Rust pinpoint deliberately swallows logging
 * failures so they can't take down the matching pipeline. Callers
 * `await` the promise but ignore errors.
 *
 * `append` is ALS-aware (same pattern as `DrizzleOutboxDriver`): when a
 * `TransactionStore` tx is bound it writes through it, otherwise through
 * the base pool. Riding the tx is required for entries that reference a
 * master created in the SAME use-case tx — on the pool connection the
 * FK to the still-uncommitted master row fails and the entry is
 * silently lost.
 */
export function createDrizzleProcessingLogRepository(
  db: PostgresJsDatabase,
): ProcessingLogRepository {
  return {
    async append(
      subject: ProcessingLogSubject,
      step: ProcessingStep,
      data: Readonly<Record<string, unknown>>,
    ): Promise<void> {
      const executor = TransactionStore.get()?.db ?? db;
      await executor.insert(processingLog).values({
        id: `${PROCESSING_LOG_ID_PREFIX}_${generateTsid()}`,
        masterLocationId: 'masterLocationId' in subject ? subject.masterLocationId : null,
        locationId: 'locationId' in subject ? subject.locationId : null,
        step,
        data,
        // Statement time, not the tx-frozen now(): entries appended inside
        // one tx must sort in append order on the timeline.
        createdAt: sql`clock_timestamp()`,
      });
    },

    async list(subject: ProcessingLogSubject): Promise<readonly ProcessingLogEntry[]> {
      // TSID tiebreaker: entries appended inside one tx share the same
      // now() timestamp, and TSIDs are time-ordered.
      const rows = await db
        .select()
        .from(processingLog)
        .where(
          'masterLocationId' in subject
            ? eq(processingLog.masterLocationId, subject.masterLocationId)
            : eq(processingLog.locationId, subject.locationId),
        )
        .orderBy(asc(processingLog.createdAt), asc(processingLog.id));
      return rows.map(toDomain);
    },
  };
}
