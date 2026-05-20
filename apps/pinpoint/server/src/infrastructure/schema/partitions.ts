import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { clients } from './clients.js';

export const partitions = pgTable(
  'partitions',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idx_partitions_client_code').on(t.clientId, t.code)],
);

export type NewPartition = typeof partitions.$inferInsert;
export type PartitionRow = typeof partitions.$inferSelect;
