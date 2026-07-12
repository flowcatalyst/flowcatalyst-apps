import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import {
  DEFAULT_STORE_PROFILE_CODE,
  resolveStoreSettings,
  type ResolvedStoreSettings,
  type StoreSettings,
} from '@fulfil-go/shared';
import { storeProfiles } from './schema/store-profiles.js';
import { stores } from './schema/stores.js';

/**
 * Resolve operational settings per store: code defaults ⇐ 'default'
 * profile ⇐ store's profile ⇐ store overrides (field-level; see the shared
 * contract). A store with no registry row resolves through the default
 * profile — settings must never block order intake.
 */
export interface StoreSettingsResolver {
  resolve(storeRef: string): ResolvedStoreSettings;
  /** Resolution for a store with no registry row / no assignment. */
  readonly defaults: ResolvedStoreSettings;
}

export async function loadStoreSettingsResolver(
  db: PostgresJsDatabase,
  clientId: string,
  storeRefs?: readonly string[],
): Promise<StoreSettingsResolver> {
  // Joins the ambient use-case tx when one is bound (ALS) — this runs inside
  // create-fulfilment's runWrite, and a bare pool read there self-deadlocks
  // the pool under concurrent writes (see CLAUDE.md gotcha).
  const client = resolveDb(db, TransactionStore.get());
  const profileRows = await client
    .select({ code: storeProfiles.code, settings: storeProfiles.settings })
    .from(storeProfiles)
    .where(eq(storeProfiles.clientId, clientId));
  const profileSettings = new Map(profileRows.map((p) => [p.code, p.settings as StoreSettings]));
  const defaultProfile = profileSettings.get(DEFAULT_STORE_PROFILE_CODE) ?? null;

  const storeRows = await client
    .select({
      storeRef: stores.storeRef,
      profileCode: stores.profileCode,
      settingsOverrides: stores.settingsOverrides,
    })
    .from(stores)
    .where(
      storeRefs && storeRefs.length > 0
        ? and(eq(stores.clientId, clientId), inArray(stores.storeRef, [...storeRefs]))
        : eq(stores.clientId, clientId),
    );
  const storeByRef = new Map(storeRows.map((s) => [s.storeRef, s]));

  const defaults = resolveStoreSettings(defaultProfile);
  const cache = new Map<string, ResolvedStoreSettings>();

  return {
    defaults,
    resolve(storeRef) {
      const cached = cache.get(storeRef);
      if (cached) return cached;
      const store = storeByRef.get(storeRef);
      const resolved = store
        ? resolveStoreSettings(
            defaultProfile,
            store.profileCode === DEFAULT_STORE_PROFILE_CODE
              ? null
              : (profileSettings.get(store.profileCode) ?? null),
            (store.settingsOverrides as StoreSettings | null) ?? null,
          )
        : defaults;
      cache.set(storeRef, resolved);
      return resolved;
    },
  };
}
