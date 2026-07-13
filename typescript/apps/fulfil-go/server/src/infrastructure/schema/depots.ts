import { doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Depots — transport-context topology, INDEPENDENT of stores (Andrew,
 * 2026-07-13: no 1:1 depot↔store). A depot is where drivers are based;
 * the link table says which stores it serves (many-to-many: one depot
 * serves several stores, and a store may be covered by more than one
 * depot). A dark store running its own drivers is just a depot serving
 * one store — no special case.
 *
 * `depot_ref` is the client-scoped business key (mirrors stores.store_ref).
 * For EPOD-adopted clients it is set to EPOD's depot reference, so their
 * claim proxy's `depotReference` resolves directly.
 */
export const depots = pgTable(
  'depots',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    depotRef: text('depot_ref').notNull(),
    name: text('name').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_depots_client_ref').on(t.clientId, t.depotRef)],
);

export type DepotRow = typeof depots.$inferSelect;

/** Which stores a depot serves (M:N — registry-validated on write). */
export const depotStores = pgTable(
  'depot_stores',
  {
    clientId: text('client_id').notNull(),
    depotRef: text('depot_ref').notNull(),
    storeRef: text('store_ref').notNull(),
  },
  (t) => [
    uniqueIndex('uq_depot_stores_link').on(t.clientId, t.depotRef, t.storeRef),
    index('idx_depot_stores_store').on(t.clientId, t.storeRef),
  ],
);

export type DepotStoreRow = typeof depotStores.$inferSelect;
