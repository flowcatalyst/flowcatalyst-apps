import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  TransactionStore,
  resolveDb,
  type TransactionContext,
} from '@flowcatalyst-apps/app-framework';
import { ConcurrencyConflictError } from '@fulfil-go/framework';
import { asDriverUserId, type DriverUserId } from '../domain/driver-identity/ids.js';
import {
  DRIVER_USER_TYPE,
  type DriverStatus,
  type DriverUser,
} from '../domain/driver-identity/driver-user.js';
import type { DriverUserRepository } from '../domain/driver-identity/driver-user.repository.js';
import { driverUsers, type DriverUserRow } from './schema/driver-users.js';

function toDomain(row: DriverUserRow): DriverUser {
  return {
    id: asDriverUserId(row.id),
    clientId: row.clientId,
    depotRef: row.depotRef,
    displayName: row.displayName,
    staffCode: row.staffCode,
    status: row.status as DriverStatus,
    defaultVehicleReg: row.defaultVehicleReg,
    defaultVehicleClass: row.defaultVehicleClass,
    pinHash: row.pinHash,
    failedPinAttempts: row.failedPinAttempts,
    lockedUntil: row.lockedUntil,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleDriverUserRepository(db: PostgresJsDatabase): DriverUserRepository {
  // Reads join the ambient use-case tx (ALS) — pool self-deadlock rule.
  const current = () => resolveDb(db, TransactionStore.get());
  return {
    async persist(aggregate: DriverUser, tx?: TransactionContext): Promise<DriverUser> {
      const client = resolveDb(db, tx);
      let row: DriverUserRow | undefined;
      if (aggregate.version === 1) {
        [row] = await client
          .insert(driverUsers)
          .values({
            id: aggregate.id,
            clientId: aggregate.clientId,
            depotRef: aggregate.depotRef,
            displayName: aggregate.displayName,
            staffCode: aggregate.staffCode,
            status: aggregate.status,
            defaultVehicleReg: aggregate.defaultVehicleReg,
            defaultVehicleClass: aggregate.defaultVehicleClass,
            pinHash: aggregate.pinHash,
            failedPinAttempts: aggregate.failedPinAttempts,
            lockedUntil: aggregate.lockedUntil,
            version: aggregate.version,
            createdAt: aggregate.createdAt,
            updatedAt: aggregate.updatedAt,
          })
          .returning();
      } else {
        // Optimistic locking (house rule): guard on the prior version.
        // (Lockout bookkeeping bypasses this via updateLockout.)
        [row] = await client
          .update(driverUsers)
          .set({
            depotRef: aggregate.depotRef,
            displayName: aggregate.displayName,
            status: aggregate.status,
            defaultVehicleReg: aggregate.defaultVehicleReg,
            defaultVehicleClass: aggregate.defaultVehicleClass,
            pinHash: aggregate.pinHash,
            failedPinAttempts: aggregate.failedPinAttempts,
            lockedUntil: aggregate.lockedUntil,
            version: aggregate.version,
            updatedAt: aggregate.updatedAt,
          })
          .where(
            and(eq(driverUsers.id, aggregate.id), eq(driverUsers.version, aggregate.version - 1)),
          )
          .returning();
        if (!row) {
          throw new ConcurrencyConflictError(DRIVER_USER_TYPE, aggregate.id, aggregate.version - 1);
        }
      }
      if (!row) throw new Error(`DriverUser persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: DriverUser, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client
        .delete(driverUsers)
        .where(eq(driverUsers.id, aggregate.id))
        .returning();
      return rows.length > 0;
    },

    async findById(clientId: string, id: DriverUserId): Promise<DriverUser | null> {
      const [row] = await current()
        .select()
        .from(driverUsers)
        .where(and(eq(driverUsers.clientId, clientId), eq(driverUsers.id, id)))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async findByStaffCode(
      clientId: string,
      depotRef: string,
      staffCode: string,
    ): Promise<DriverUser | null> {
      const [row] = await current()
        .select()
        .from(driverUsers)
        .where(
          and(
            eq(driverUsers.clientId, clientId),
            eq(driverUsers.depotRef, depotRef),
            eq(driverUsers.staffCode, staffCode),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByClient(clientId: string, depotRef?: string): Promise<readonly DriverUser[]> {
      const where = depotRef
        ? and(eq(driverUsers.clientId, clientId), eq(driverUsers.depotRef, depotRef))
        : eq(driverUsers.clientId, clientId);
      const rows = await current()
        .select()
        .from(driverUsers)
        .where(where)
        .orderBy(asc(driverUsers.depotRef), asc(driverUsers.staffCode));
      return rows.map(toDomain);
    },

    async insertManyIfAbsent(drivers: readonly DriverUser[]): Promise<number> {
      if (drivers.length === 0) return 0;
      const rows = await current()
        .insert(driverUsers)
        .values(
          drivers.map((d) => ({
            id: d.id,
            clientId: d.clientId,
            depotRef: d.depotRef,
            displayName: d.displayName,
            staffCode: d.staffCode,
            status: d.status,
            defaultVehicleReg: d.defaultVehicleReg,
            defaultVehicleClass: d.defaultVehicleClass,
            pinHash: d.pinHash,
            failedPinAttempts: d.failedPinAttempts,
            lockedUntil: d.lockedUntil,
            version: d.version,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          })),
        )
        .onConflictDoNothing({
          target: [driverUsers.clientId, driverUsers.depotRef, driverUsers.staffCode],
        })
        .returning({ id: driverUsers.id });
      return rows.length;
    },

    async resetSeededPins(clientId: string, pinHash: string): Promise<number> {
      const rows = await current()
        .update(driverUsers)
        .set({ pinHash, failedPinAttempts: 0, lockedUntil: null, updatedAt: new Date() })
        .where(
          and(eq(driverUsers.clientId, clientId), sql`${driverUsers.staffCode} ~ '^D[0-9]{2}$'`),
        )
        .returning({ id: driverUsers.id });
      return rows.length;
    },

    async updateLockout(driver: DriverUser, tx?: TransactionContext): Promise<void> {
      const client = resolveDb(db, tx);
      await client
        .update(driverUsers)
        .set({
          failedPinAttempts: driver.failedPinAttempts,
          lockedUntil: driver.lockedUntil,
          updatedAt: driver.updatedAt,
        })
        .where(eq(driverUsers.id, driver.id));
    },
  };
}
