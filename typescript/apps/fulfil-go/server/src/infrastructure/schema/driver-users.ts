import { integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

/**
 * Driver users — transport-context local identities bound to a HOME DEPOT
 * (`store_ref` — our stores are the collection points). Credentials are
 * stored ONLY as scrypt hashes (`pin_hash`). Staff code is unique within a
 * depot so PIN login can resolve the driver from (depot, staffCode).
 */
export const driverUsers = pgTable(
  'driver_users',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    storeRef: text('store_ref').notNull(),
    displayName: text('display_name').notNull(),
    staffCode: text('staff_code').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    defaultVehicleReg: text('default_vehicle_reg'),
    pinHash: text('pin_hash'),
    failedPinAttempts: integer('failed_pin_attempts').notNull().default(0),
    lockedUntil: timestampColumn('locked_until'),
    version: integer('version').notNull().default(1),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    updatedAt: timestampColumn('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_driver_users_staff_code').on(t.clientId, t.storeRef, t.staffCode)],
);

export type NewDriverUser = typeof driverUsers.$inferInsert;
export type DriverUserRow = typeof driverUsers.$inferSelect;
