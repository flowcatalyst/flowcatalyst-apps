import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Store profiles — named bundles of operational settings (see the shared
 * StoreSettingsSchema). Reference data like stores, not an aggregate.
 * The 'default' profile is virtual until first edited: resolution treats a
 * missing row as "no overrides" (code defaults apply), so nothing needs
 * seeding. Stores link by (client_id, profile_code); field-level store
 * overrides live on the stores row.
 */
export const storeProfiles = pgTable(
  'store_profiles',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    settings: jsonb('settings').notNull(),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_store_profiles_client_code').on(t.clientId, t.code)],
);

export type StoreProfileRow = typeof storeProfiles.$inferSelect;
