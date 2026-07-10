import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
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
  // Reads join the ambient use-case tx (ALS) — see pick-repository for why
  // (in-tx visibility + pool self-deadlock under concurrent write bursts).
  const current = () => resolveDb(db, TransactionStore.get());
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
            storeRef: aggregate.storeRef,
            displayName: aggregate.displayName,
            primaryAuthMethod: aggregate.primaryAuthMethod,
            status: aggregate.status,
            pinHash: aggregate.pinHash,
            failedPinAttempts: aggregate.failedPinAttempts,
            lockedUntil: aggregate.lockedUntil,
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
      const [row] = await current()
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
      const [row] = await current()
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

    async listByClient(clientId: string, storeRef?: string): Promise<readonly PickerUser[]> {
      const where = storeRef
        ? and(eq(pickerUsers.clientId, clientId), eq(pickerUsers.storeRef, storeRef))
        : eq(pickerUsers.clientId, clientId);
      const rows = await current()
        .select()
        .from(pickerUsers)
        .where(where)
        .orderBy(asc(pickerUsers.storeRef), asc(pickerUsers.staffCode));
      return rows.map(toDomain);
    },

    async findByIds(clientId: string, ids: readonly string[]): Promise<readonly PickerUser[]> {
      if (ids.length === 0) return [];
      const rows = await current()
        .select()
        .from(pickerUsers)
        .where(and(eq(pickerUsers.clientId, clientId), inArray(pickerUsers.id, [...ids])));
      return rows.map(toDomain);
    },

    async insertManyIfAbsent(pickers: readonly PickerUser[]): Promise<number> {
      if (pickers.length === 0) return 0;
      const rows = await current()
        .insert(pickerUsers)
        .values(
          pickers.map((p) => ({
            id: p.id,
            clientId: p.clientId,
            storeRef: p.storeRef,
            displayName: p.displayName,
            staffCode: p.staffCode,
            primaryAuthMethod: p.primaryAuthMethod,
            status: p.status,
            pinHash: p.pinHash,
            failedPinAttempts: p.failedPinAttempts,
            lockedUntil: p.lockedUntil,
            version: p.version,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        )
        .onConflictDoNothing({
          target: [pickerUsers.clientId, pickerUsers.storeRef, pickerUsers.staffCode],
        })
        .returning({ id: pickerUsers.id });
      return rows.length;
    },

    async resetSeededPins(clientId: string, pinHash: string): Promise<number> {
      const rows = await current()
        .update(pickerUsers)
        .set({ pinHash, failedPinAttempts: 0, lockedUntil: null, updatedAt: new Date() })
        .where(
          and(
            eq(pickerUsers.clientId, clientId),
            sql`${pickerUsers.staffCode} ~ '^P[0-9]{2}$'`,
          ),
        )
        .returning({ id: pickerUsers.id });
      return rows.length;
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
