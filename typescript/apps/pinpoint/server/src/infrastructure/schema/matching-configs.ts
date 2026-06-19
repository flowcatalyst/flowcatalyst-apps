/**
 * Matching configs — fuzzy / spatial / textual thresholds applied during
 * the address-resolution pipeline (Rust pinpoint-domain/entities/
 * matching_config.rs + migration 003_matching_config.sql).
 *
 * Resolution precedence: (client_id, partition_id) → (client_id, NULL)
 * → (NULL, NULL) i.e. the global default. The `mcf_GLOBAL_DEFAULT` row
 * seeded in the same migration is the fallback; it's inserted by the
 * generated drizzle migration via a follow-up custom SQL.
 *
 * UNIQUE NULLS NOT DISTINCT on (client_id, partition_id) makes
 * (NULL, NULL) unique — Postgres 15+ semantics required.
 */
import { doublePrecision, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';
import { clients } from './clients.js';
import { partitions } from './partitions.js';

export const matchingConfigs = pgTable(
  'matching_configs',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').references(() => clients.id),
    partitionId: text('partition_id').references(() => partitions.id),
    streetThreshold: doublePrecision('street_threshold').notNull().default(0.85),
    houseNumberThreshold: doublePrecision('house_number_threshold').notNull().default(1.0),
    postalCodeThreshold: doublePrecision('postal_code_threshold').notNull().default(0.95),
    stateThreshold: doublePrecision('state_threshold').notNull().default(0.9),
    addressNameThreshold: doublePrecision('address_name_threshold').notNull().default(0.8),
    overallThreshold: doublePrecision('overall_threshold').notNull().default(0.85),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('matching_configs_client_partition_uq').on(t.clientId, t.partitionId).nullsNotDistinct(),
  ],
);

export type NewMatchingConfig = typeof matchingConfigs.$inferInsert;
export type MatchingConfigRow = typeof matchingConfigs.$inferSelect;
