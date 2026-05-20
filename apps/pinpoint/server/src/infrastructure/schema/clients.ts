import { pgTable, text, varchar, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

export const clients = pgTable(
  'clients',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idx_clients_code').on(t.code)],
);

export type NewClient = typeof clients.$inferInsert;
export type ClientRow = typeof clients.$inferSelect;
