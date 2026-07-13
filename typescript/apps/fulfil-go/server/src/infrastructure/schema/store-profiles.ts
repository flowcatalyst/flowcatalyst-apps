import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Store profiles — named bundles of operational settings, one namespace per
 * OWNING DOMAIN ('pick' | 'transport'; shared Pick/TransportStoreSettings
 * schemas). Reference data like stores, not an aggregate. The 'default'
 * profile is virtual (per domain) until first edited: resolution treats a
 * missing row as "no overrides" (code defaults apply), so nothing needs
 * seeding. Stores link by (client_id, domain → profile code column);
 * field-level store overrides live on the stores row per domain.
 */
export const storeProfiles = pgTable(
  'store_profiles',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    /** Owning context: 'pick' | 'transport' (StoreSettingsDomain). */
    domain: text('domain').notNull().default('pick'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    settings: jsonb('settings').notNull(),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_store_profiles_client_domain_code').on(t.clientId, t.domain, t.code)],
);

export type StoreProfileRow = typeof storeProfiles.$inferSelect;
