/**
 * Principal ↔ partition membership join table.
 *
 * Carries `granted_by` (FK to principals) + `granted_at` for audit. Slice 1
 * couldn't ship this because it depends on `partitions` — Slice 2 lands both
 * tables, and the join is added here at the same time.
 *
 * No API surface yet; queried by future authorization work (slice TBD) via
 * the PrincipalRepository's `findPartitionIds` / `grantPartitionAccess` /
 * `revokePartitionAccess` methods.
 */
import { pgTable, primaryKey, text, index } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { principals } from './principals.js';
import { partitions } from './partitions.js';

export const principalPartitions = pgTable(
  'principal_partitions',
  {
    principalId: text('principal_id')
      .notNull()
      .references(() => principals.id),
    partitionId: text('partition_id')
      .notNull()
      .references(() => partitions.id),
    grantedBy: text('granted_by')
      .notNull()
      .references(() => principals.id),
    grantedAt: timestampColumn('granted_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.principalId, t.partitionId] }),
    index('idx_principal_partitions_principal').on(t.principalId),
    index('idx_principal_partitions_partition').on(t.partitionId),
  ],
);

export type NewPrincipalPartition = typeof principalPartitions.$inferInsert;
export type PrincipalPartitionRow = typeof principalPartitions.$inferSelect;
