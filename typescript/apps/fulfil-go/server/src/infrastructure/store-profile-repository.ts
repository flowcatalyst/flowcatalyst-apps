import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import { brandedTsid } from '@fulfil-go/framework';
import { DEFAULT_STORE_PROFILE_CODE, type StoreSettings } from '@fulfil-go/shared';
import { storeProfiles } from './schema/store-profiles.js';
import { stores } from './schema/stores.js';

/**
 * Command-side repository for store-profile reference data (see the
 * CQRS-lite convention in CLAUDE.md: routes never touch drizzle directly —
 * writes go through a repository; cross-table reads live in query modules).
 * Store profiles are reference data, not an aggregate: plain idempotent
 * upserts, no version column.
 */
export interface StoreProfileSummary {
  readonly code: string;
  readonly name: string;
  readonly settings: StoreSettings;
}

export interface StoreProfileRepository {
  listByClient(clientId: string): Promise<readonly StoreProfileSummary[]>;
  upsert(
    clientId: string,
    code: string,
    name: string | undefined,
    settings: StoreSettings,
  ): Promise<StoreProfileSummary>;
  exists(clientId: string, code: string): Promise<boolean>;
  /** Assign a profile and/or field-level overrides to a store. Null overrides clears them. */
  assignStore(
    clientId: string,
    storeRef: string,
    patch: { profileCode?: string; overrides?: StoreSettings | null },
  ): Promise<{ storeRef: string; profileCode: string } | null>;
}

export function createDrizzleStoreProfileRepository(
  db: PostgresJsDatabase,
): StoreProfileRepository {
  const current = () => resolveDb(db, TransactionStore.get());
  return {
    async listByClient(clientId) {
      const rows = await current()
        .select()
        .from(storeProfiles)
        .where(eq(storeProfiles.clientId, clientId))
        .orderBy(storeProfiles.code);
      const profiles = rows.map((r) => ({
        code: r.code,
        name: r.name,
        settings: (r.settings ?? {}) as StoreSettings,
      }));
      // The reserved default profile is virtual until first saved.
      if (!profiles.some((p) => p.code === DEFAULT_STORE_PROFILE_CODE)) {
        profiles.unshift({ code: DEFAULT_STORE_PROFILE_CODE, name: 'Default', settings: {} });
      }
      return profiles;
    },

    async upsert(clientId, code, name, settings) {
      const [row] = await current()
        .insert(storeProfiles)
        .values({ id: brandedTsid('spr'), clientId, code, name: name ?? code, settings })
        .onConflictDoUpdate({
          target: [storeProfiles.clientId, storeProfiles.code],
          set: {
            ...(name !== undefined ? { name } : {}),
            settings,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { code: row!.code, name: row!.name, settings: (row!.settings ?? {}) as StoreSettings };
    },

    async exists(clientId, code) {
      const [row] = await current()
        .select({ code: storeProfiles.code })
        .from(storeProfiles)
        .where(and(eq(storeProfiles.clientId, clientId), eq(storeProfiles.code, code)))
        .limit(1);
      return Boolean(row);
    },

    async assignStore(clientId, storeRef, patch) {
      const [row] = await current()
        .update(stores)
        .set({
          ...(patch.profileCode !== undefined ? { profileCode: patch.profileCode } : {}),
          ...(patch.overrides !== undefined ? { settingsOverrides: patch.overrides } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(stores.clientId, clientId), eq(stores.storeRef, storeRef)))
        .returning({ storeRef: stores.storeRef, profileCode: stores.profileCode });
      return row ?? null;
    },
  };
}
