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
    /**
     * OWNERSHIP STAMP (docs/process-definitions.md): the core process
     * definition coordinating this fulfilment, resolved from client settings
     * at creation. Reactions dispatch on the stamp — reconfiguring a client
     * migrates NEW fulfilments only; in-flight ones finish on theirs.
     */
    processDefinition: varchar('process_definition', { length: 64 }).notNull().default('standard'),
    slotStart: timestampColumn('slot_start').notNull(),
    slotEnd: timestampColumn('slot_end').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    destination: jsonb('destination').notNull(),
    policies: jsonb('policies').notNull(),
    /**
     * Handover policy stamp + secrets (docs/handover-verification.md).
     * Pins are one-shot handover codes stored plaintext (they must be
     * retrievable for the audited reveal and provider pushes) — they never
     * appear on DTOs, events, or the driver app. Null = pre-feature rows.
     */
    handoverPolicy: jsonb('handover_policy'),
    deliveryPin: varchar('delivery_pin', { length: 8 }),
    /** Highest line restrictedMinAge; null = nothing age-restricted. */
    maxRestrictedAge: integer('max_restricted_age'),
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
    // The flightboard's ±24h slot window — the one read that still
    // seq-scanned at volume (2026-07 index pass). client_id/slot_start never
    // change, so status transitions stay HOT and writes don't touch this.
    index('idx_fulfilments_client_slot').on(t.clientId, t.slotStart),
  ],
);

export type NewFulfilment = typeof fulfilments.$inferInsert;
export type FulfilmentRow = typeof fulfilments.$inferSelect;
