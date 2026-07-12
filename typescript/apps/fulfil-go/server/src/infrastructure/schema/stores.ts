import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Store registry — the anchor pickers (and later devices) bind to, and the
 * seed source for picker generation. Reference data, not a domain aggregate:
 * synced via plain upserts (management app pushes the generator fixtures; a
 * real integration would sync from master data). `data` holds the full
 * as-received record (address, geo, contact, collection point, …).
 */
export const stores = pgTable(
  'stores',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    storeRef: text('store_ref').notNull(),
    name: text('name').notNull(),
    city: text('city'),
    region: text('region'),
    data: jsonb('data').notNull(),
    /** Store-profile link — 'default' unless assigned (see store-profiles). */
    profileCode: text('profile_code').notNull().default('default'),
    /** Field-level setting overrides on top of the profile (StoreSettings shape). */
    settingsOverrides: jsonb('settings_overrides'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_stores_client_ref').on(t.clientId, t.storeRef)],
);

export type NewStore = typeof stores.$inferInsert;
export type StoreRow = typeof stores.$inferSelect;
