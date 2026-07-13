import { doublePrecision, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
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
    /** Store geo (from master data / fixtures) — coverage oracle + planning. */
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** PICK profile link — 'default' unless assigned (see store-profiles). */
    pickProfileCode: text('pick_profile_code').notNull().default('default'),
    /** Field-level pick overrides on top of the profile (PickStoreSettings). */
    pickSettingsOverrides: jsonb('pick_settings_overrides'),
    /** TRANSPORT profile link — 'default' unless assigned. */
    transportProfileCode: text('transport_profile_code').notNull().default('default'),
    /** Field-level transport overrides (TransportStoreSettings). */
    transportSettingsOverrides: jsonb('transport_settings_overrides'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_stores_client_ref').on(t.clientId, t.storeRef)],
);

export type NewStore = typeof stores.$inferInsert;
export type StoreRow = typeof stores.$inferSelect;
