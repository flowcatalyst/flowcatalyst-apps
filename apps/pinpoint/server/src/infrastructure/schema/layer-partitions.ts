/**
 * Layer-to-partition assignments. Wildcard semantics: if a layer has NO
 * rows here it applies to ALL partitions; if it has rows it's restricted
 * to those partitions only. Mirrors migration 017.
 *
 * Slice 4 lands the table; population happens via Layer use cases in a
 * later slice (no `assign-layer-to-partition` use case yet).
 */
import { index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { layers } from './layers.js';
import { partitions } from './partitions.js';

export const layerPartitions = pgTable(
  'layer_partitions',
  {
    layerId: text('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    partitionId: text('partition_id')
      .notNull()
      .references(() => partitions.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.layerId, t.partitionId] }),
    index('idx_layer_partitions_layer').on(t.layerId),
    index('idx_layer_partitions_partition').on(t.partitionId),
  ],
);

export type NewLayerPartition = typeof layerPartitions.$inferInsert;
export type LayerPartitionRow = typeof layerPartitions.$inferSelect;
