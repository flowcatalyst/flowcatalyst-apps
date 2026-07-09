import { index, integer, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

export const fulfilments = pgTable(
  'fulfilments',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    externalSource: varchar('external_source', { length: 64 }).notNull(),
    externalRef: varchar('external_ref', { length: 128 }).notNull(),
    type: varchar('type', { length: 16 }).notNull(),
    serviceLevel: varchar('service_level', { length: 16 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('created'),
    slotStart: timestampColumn('slot_start').notNull(),
    slotEnd: timestampColumn('slot_end').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    destination: jsonb('destination').notNull(),
    policies: jsonb('policies').notNull(),
    provenance: jsonb('provenance'),
    additionalData: jsonb('additional_data'),
    version: integer('version').notNull().default(1),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The create-idempotency backstop: one fulfilment per upstream reference.
    uniqueIndex('idx_fulfilments_external').on(t.clientId, t.externalSource, t.externalRef),
    index('idx_fulfilments_client_created').on(t.clientId, t.createdAt),
  ],
);

export type NewFulfilment = typeof fulfilments.$inferInsert;
export type FulfilmentRow = typeof fulfilments.$inferSelect;
