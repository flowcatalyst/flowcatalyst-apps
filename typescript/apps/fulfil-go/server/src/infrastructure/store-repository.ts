import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import { brandedTsid } from '@fulfil-go/framework';
import type { StoreRecord } from '@fulfil-go/shared';
import { stores, type StoreRow } from './schema/stores.js';

export interface StoreSummary {
  readonly id: string;
  readonly storeRef: string;
  readonly name: string;
  readonly city: string | null;
  readonly region: string | null;
  readonly profileCode: string;
}

export interface StoreRepository {
  /** Idempotent bulk sync keyed on (clientId, storeRef). Returns rows written. */
  upsertMany(clientId: string, records: readonly StoreRecord[]): Promise<number>;
  listByClient(clientId: string): Promise<readonly StoreSummary[]>;
  existsByRef(clientId: string, storeRef: string): Promise<boolean>;
}

function toSummary(row: StoreRow): StoreSummary {
  return {
    id: row.id,
    storeRef: row.storeRef,
    name: row.name,
    city: row.city,
    region: row.region,
    profileCode: row.profileCode,
  };
}

export function createDrizzleStoreRepository(db: PostgresJsDatabase): StoreRepository {
  // Reads join the ambient use-case tx (ALS) — see pick-repository for why.
  // existsByRef runs inside create-picker/reassign transactions.
  const current = () => resolveDb(db, TransactionStore.get());
  return {
    async upsertMany(clientId: string, records: readonly StoreRecord[]): Promise<number> {
      if (records.length === 0) return 0;
      const now = new Date();
      const rows = await current()
        .insert(stores)
        .values(
          records.map((record) => ({
            id: brandedTsid('str'),
            clientId,
            storeRef: record.ref,
            name: record.name,
            city: record.city ?? null,
            region: record.region ?? null,
            data: record,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [stores.clientId, stores.storeRef],
          set: {
            name: sql`excluded.name`,
            city: sql`excluded.city`,
            region: sql`excluded.region`,
            data: sql`excluded.data`,
            updatedAt: now,
          },
        })
        .returning({ id: stores.id });
      return rows.length;
    },

    async listByClient(clientId: string): Promise<readonly StoreSummary[]> {
      const rows = await current()
        .select()
        .from(stores)
        .where(eq(stores.clientId, clientId))
        .orderBy(asc(stores.storeRef));
      return rows.map(toSummary);
    },

    async existsByRef(clientId: string, storeRef: string): Promise<boolean> {
      const [row] = await current()
        .select({ id: stores.id })
        .from(stores)
        .where(and(eq(stores.clientId, clientId), eq(stores.storeRef, storeRef)))
        .limit(1);
      return row !== undefined;
    },
  };
}
