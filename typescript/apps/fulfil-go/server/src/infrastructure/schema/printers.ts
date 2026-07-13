import { boolean, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Store-bound label printers — base equipment reference data, like stores
 * (docs/bag-label-printing.md). The server renders ZPL sized to the label
 * dimensions; the picking app delivers to host:port on the store LAN.
 */
export const printers = pgTable(
  'printers',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    storeRef: text('store_ref').notNull(),
    name: text('name').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull().default(9100),
    dpi: integer('dpi').notNull().default(203),
    labelWidthMm: integer('label_width_mm').notNull().default(100),
    labelHeightMm: integer('label_height_mm').notNull().default(75),
    active: boolean('active').notNull().default(true),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_printers_client_store_name').on(t.clientId, t.storeRef, t.name)],
);

export type NewPrinter = typeof printers.$inferInsert;
export type PrinterRow = typeof printers.$inferSelect;
