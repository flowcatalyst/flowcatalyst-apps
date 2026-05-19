/**
 * Principals — identities authenticated against the pinpoint API.
 *
 * `id` is the OIDC subject (`sub` claim) verbatim — NOT a TSID — because
 * the platform's identity provider owns it. The `text` column is therefore
 * unbounded length to accommodate arbitrary `iss|sub` shapes.
 *
 * The `principal_partitions` join table (which references `partitions`)
 * lands in Slice 2 alongside the partitions table itself.
 */
import { pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

export const principals = pgTable('principals', {
  id: text('id').primaryKey(),
  principalType: varchar('principal_type', { length: 20 }).notNull(),
  name: text('name').notNull(),
  email: text('email'),
  createdAt: timestampColumn('created_at').notNull().defaultNow(),
  updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
});

export type NewPrincipal = typeof principals.$inferInsert;
export type PrincipalRow = typeof principals.$inferSelect;
