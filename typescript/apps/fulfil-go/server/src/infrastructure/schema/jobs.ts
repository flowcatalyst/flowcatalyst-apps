import { index, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    status: varchar('status', { length: 20 }).notNull().default('created'),
    title: text('title').notNull(),
    details: text('details'),
    assigneeId: text('assignee_id'),
    assignedAt: timestampColumn('assigned_at'),
    acceptedAt: timestampColumn('accepted_at'),
    completedAt: timestampColumn('completed_at'),
    version: integer('version').notNull().default(1),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [index('idx_jobs_assignee').on(t.assigneeId)],
);

export type NewJob = typeof jobs.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
