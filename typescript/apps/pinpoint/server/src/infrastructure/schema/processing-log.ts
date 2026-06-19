/**
 * Per-master-location audit trail for the matching pipeline.
 * Verbatim port of Rust migration 014. Each step the pipeline runs
 * (normalize, matched, created, validated, …) appends one row with
 * JSONB payload — kept separate from `master_locations` so the
 * hot-path matcher doesn't drag this around.
 *
 * Append-only by design; no UPDATE path. Rows cascade with the parent
 * master row on delete.
 */
import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { masterLocations } from './master-locations.js';

export const processingLog = pgTable(
  'processing_log',
  {
    id: text('id').primaryKey(),
    masterLocationId: text('master_location_id')
      .notNull()
      .references(() => masterLocations.id, { onDelete: 'cascade' }),
    step: text('step').notNull(),
    data: jsonb('data').notNull().default({}),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_processing_log_master').on(t.masterLocationId),
    index('idx_processing_log_step').on(t.masterLocationId, t.step),
  ],
);

export type NewProcessingLogEntry = typeof processingLog.$inferInsert;
export type ProcessingLogRow = typeof processingLog.$inferSelect;
