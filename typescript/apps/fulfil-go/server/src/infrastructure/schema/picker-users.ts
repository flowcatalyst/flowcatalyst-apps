import { integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Picker users — pick-context local identities bound to a store. Credentials
 * are stored ONLY as scrypt hashes (`pin_hash`). Staff code is unique within a
 * store so PIN login can resolve the picker from (store, staffCode).
 */
export const pickerUsers = pgTable(
  'picker_users',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    storeRef: text('store_ref').notNull(),
    displayName: text('display_name').notNull(),
    staffCode: text('staff_code').notNull(),
    primaryAuthMethod: varchar('primary_auth_method', { length: 8 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    pinHash: text('pin_hash'),
    failedPinAttempts: integer('failed_pin_attempts').notNull().default(0),
    lockedUntil: timestampColumn('locked_until'),
    version: integer('version').notNull().default(1),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_picker_users_staff_code').on(t.clientId, t.storeRef, t.staffCode)],
);

export type NewPickerUser = typeof pickerUsers.$inferInsert;
export type PickerUserRow = typeof pickerUsers.$inferSelect;
