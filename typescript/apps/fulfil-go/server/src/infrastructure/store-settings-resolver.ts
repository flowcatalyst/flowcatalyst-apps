import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import {
  DEFAULT_STORE_PROFILE_CODE,
  resolvePickStoreSettings,
  resolveTransportStoreSettings,
  type PickStoreSettings,
  type ResolvedPickStoreSettings,
  type ResolvedTransportStoreSettings,
  type StoreSettingsDomain,
  type TransportStoreSettings,
} from '@fulfil-go/shared';
import { storeProfiles } from './schema/store-profiles.js';
import { stores } from './schema/stores.js';

/**
 * Resolve operational settings per store and DOMAIN: code defaults ⇐
 * 'default' profile ⇐ store's profile ⇐ store overrides (field-level; see
 * the shared contract). A store with no registry row resolves through the
 * default profile — settings must never block order intake.
 */
export interface StoreSettingsResolver<R> {
  resolve(storeRef: string): R;
  /** Resolution for a store with no registry row / no assignment. */
  readonly defaults: R;
}

interface StoreLayerRow {
  readonly profileCode: string;
  readonly overrides: object | null;
}

async function loadLayers(
  db: PostgresJsDatabase,
  clientId: string,
  domain: StoreSettingsDomain,
  storeRefs?: readonly string[],
): Promise<{
  profileSettings: Map<string, object>;
  defaultProfile: object | null;
  storeByRef: Map<string, StoreLayerRow>;
}> {
  // Joins the ambient use-case tx when one is bound (ALS) — this runs inside
  // create-fulfilment's runWrite, and a bare pool read there self-deadlocks
  // the pool under concurrent writes (see CLAUDE.md gotcha).
  const client = resolveDb(db, TransactionStore.get());
  const profileRows = await client
    .select({ code: storeProfiles.code, settings: storeProfiles.settings })
    .from(storeProfiles)
    .where(and(eq(storeProfiles.clientId, clientId), eq(storeProfiles.domain, domain)));
  const profileSettings = new Map(profileRows.map((p) => [p.code, p.settings as object]));
  const defaultProfile = profileSettings.get(DEFAULT_STORE_PROFILE_CODE) ?? null;

  const storeRows = await client
    .select({
      storeRef: stores.storeRef,
      pickProfileCode: stores.pickProfileCode,
      pickSettingsOverrides: stores.pickSettingsOverrides,
      transportProfileCode: stores.transportProfileCode,
      transportSettingsOverrides: stores.transportSettingsOverrides,
    })
    .from(stores)
    .where(
      storeRefs && storeRefs.length > 0
        ? and(eq(stores.clientId, clientId), inArray(stores.storeRef, [...storeRefs]))
        : eq(stores.clientId, clientId),
    );
  const storeByRef = new Map(
    storeRows.map((s) => [
      s.storeRef,
      domain === 'pick'
        ? { profileCode: s.pickProfileCode, overrides: s.pickSettingsOverrides as object | null }
        : {
            profileCode: s.transportProfileCode,
            overrides: s.transportSettingsOverrides as object | null,
          },
    ]),
  );
  return { profileSettings, defaultProfile, storeByRef };
}

function buildResolver<R>(
  layers: Awaited<ReturnType<typeof loadLayers>>,
  collapse: (...settingsLayers: ReadonlyArray<object | null | undefined>) => R,
  /** Client-level base layer, UNDER the default profile (e.g. bagSpecs). */
  clientLayer?: object,
): StoreSettingsResolver<R> {
  const { profileSettings, defaultProfile, storeByRef } = layers;
  const defaults = collapse(clientLayer, defaultProfile);
  const cache = new Map<string, R>();
  return {
    defaults,
    resolve(storeRef) {
      const cached = cache.get(storeRef);
      if (cached) return cached;
      const store = storeByRef.get(storeRef);
      const resolved = store
        ? collapse(
            clientLayer,
            defaultProfile,
            store.profileCode === DEFAULT_STORE_PROFILE_CODE
              ? null
              : (profileSettings.get(store.profileCode) ?? null),
            store.overrides,
          )
        : defaults;
      cache.set(storeRef, resolved);
      return resolved;
    },
  };
}

export async function loadPickSettingsResolver(
  db: PostgresJsDatabase,
  clientId: string,
  storeRefs?: readonly string[],
  clientLayer?: PickStoreSettings,
): Promise<StoreSettingsResolver<ResolvedPickStoreSettings>> {
  const layers = await loadLayers(db, clientId, 'pick', storeRefs);
  return buildResolver(
    layers,
    (...l) => resolvePickStoreSettings(...(l as ReadonlyArray<PickStoreSettings | null | undefined>)),
    clientLayer,
  );
}

export async function loadTransportSettingsResolver(
  db: PostgresJsDatabase,
  clientId: string,
  storeRefs?: readonly string[],
): Promise<StoreSettingsResolver<ResolvedTransportStoreSettings>> {
  const layers = await loadLayers(db, clientId, 'transport', storeRefs);
  return buildResolver(layers, (...l) =>
    resolveTransportStoreSettings(
      ...(l as ReadonlyArray<TransportStoreSettings | null | undefined>),
    ),
  );
}
