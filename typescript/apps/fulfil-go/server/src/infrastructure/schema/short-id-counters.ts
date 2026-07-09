import { integer, pgTable, primaryKey, text, varchar } from 'drizzle-orm/pg-core';

/**
 * Sequential short-id allocation, scoped (client, store, service-day) where
 * service-day is the slot-START date in the fulfilment's timezone. A counter
 * (not random digits) avoids birthday collisions at busy-store volume and
 * gives roughly ordered numbers, which floor staff actually use.
 */
export const shortIdCounters = pgTable(
  'short_id_counters',
  {
    clientId: text('client_id').notNull(),
    originRef: varchar('origin_ref', { length: 64 }).notNull(),
    /** YYYY-MM-DD in the fulfilment's timezone. */
    serviceDay: varchar('service_day', { length: 10 }).notNull(),
    nextValue: integer('next_value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.originRef, t.serviceDay] })],
);

export type ShortIdCounterRow = typeof shortIdCounters.$inferSelect;
