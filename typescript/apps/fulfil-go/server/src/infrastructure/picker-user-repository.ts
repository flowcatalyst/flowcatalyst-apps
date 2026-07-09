import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import { ConcurrencyConflictError } from '@fulfil-go/framework';
import {
  asPickerUserId,
  type PickerUserId,
} from '../domain/pick-identity/ids.js';
import {
  PICKER_USER_TYPE,
  type PickerStatus,
  type PickerUser,
  type PrimaryAuthMethod,
} from '../domain/pick-identity/picker-user.js';
import type { PickerUserRepository } from '../domain/pick-identity/picker-user.repository.js';
import { pickerUsers, type PickerUserRow } from './schema/picker-users.js';

function toDomain(row: PickerUserRow): PickerUser {
  return {
    id: asPickerUserId(row.id),
    clientId: row.clientId,
    storeRef: row.storeRef,
    displayName: row.displayName,
    staffCode: row.staffCode,
    primaryAuthMethod: row.primaryAuthMethod as PrimaryAuthMethod,
    status: row.status as PickerStatus,
    pinHash: row.pinHash,
    failedPinAttempts: row.failedPinAttempts,
    lockedUntil: row.lockedUntil,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzlePickerUserRepository(db: PostgresJsDatabase): PickerUserRepository {
  return {
    async persist(aggregate: PickerUser, tx?: TransactionContext): Promise<PickerUser> {
      const client = resolveDb(db, tx);
      let row: PickerUserRow | undefined;
      if (aggregate.version === 1) {
        [row] = await client
          .insert(pickerUsers)
          .values({
            id: aggregate.id,
            clientId: aggregate.clientId,
            storeRef: aggregate.storeRef,
            displayName: aggregate.displayName,
            staffCode: aggregate.staffCode,
            primaryAuthMethod: aggregate.primaryAuthMethod,
            status: aggregate.status,
            pinHash: aggregate.pinHash,
            failedPinAttempts: aggregate.failedPinAttempts,
            lockedUntil: aggregate.lockedUntil,
            version: aggregate.version,
            createdAt: aggregate.createdAt,
            updatedAt: aggregate.updatedAt,
          })
          .returning();
      } else {
        // Optimistic locking (house rule): guard on the prior version. No
        // match = someone else won → ConcurrencyConflictError → 409, tx rolls
        // back. (Lockout bookkeeping bypasses this via updateLockout.)
        [row] = await client
          .update(pickerUsers)
          .set({
            displayName: aggregate.displayName,
            primaryAuthMethod: aggregate.primaryAuthMethod,
            status: aggregate.status,
            pinHash: aggregate.pinHash,
            version: aggregate.version,
            updatedAt: aggregate.updatedAt,
          })
          .where(
            and(eq(pickerUsers.id, aggregate.id), eq(pickerUsers.version, aggregate.version - 1)),
          )
          .returning();
        if (!row) {
          throw new ConcurrencyConflictError(PICKER_USER_TYPE, aggregate.id, aggregate.version - 1);
        }
      }
      if (!row) throw new Error(`PickerUser persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: PickerUser, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client.delete(pickerUsers).where(eq(pickerUsers.id, aggregate.id)).returning();
      return rows.length > 0;
    },

    async findById(clientId: string, id: PickerUserId): Promise<PickerUser | null> {
      const [row] = await db
        .select()
        .from(pickerUsers)
        .where(and(eq(pickerUsers.clientId, clientId), eq(pickerUsers.id, id)))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async findByStaffCode(
      clientId: string,
      storeRef: string,
      staffCode: string,
    ): Promise<PickerUser | null> {
      const [row] = await db
        .select()
        .from(pickerUsers)
        .where(
          and(
            eq(pickerUsers.clientId, clientId),
            eq(pickerUsers.storeRef, storeRef),
            eq(pickerUsers.staffCode, staffCode),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async updateLockout(picker: PickerUser, tx?: TransactionContext): Promise<void> {
      const client = resolveDb(db, tx);
      await client
        .update(pickerUsers)
        .set({
          failedPinAttempts: picker.failedPinAttempts,
          lockedUntil: picker.lockedUntil,
          updatedAt: picker.updatedAt,
        })
        .where(eq(pickerUsers.id, picker.id));
    },
  };
}
