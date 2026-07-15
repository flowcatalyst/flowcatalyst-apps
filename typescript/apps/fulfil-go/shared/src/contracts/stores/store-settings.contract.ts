import { z } from 'zod';
import { PickSortAlgorithm } from '../../domain/picks/pick-sort.js';
import {
  BagSpecsSchema,
  ConstructionByTemperatureSchema,
  resolveBagSpecs,
  resolveConstructionByTemperature,
  type BagSpecs,
  type ConstructionByTemperature,
  type ResolvedBagSpecs,
  type ResolvedConstructionByTemperature,
} from './bag-specs.contract.js';

/**
 * Operational store settings, split by OWNING CONTEXT (Andrew, 2026-07-13):
 * each store carries TWO independent profile assignments — a PICK profile
 * and a TRANSPORT profile — managed under that context's section in the
 * management app. Same layered resolution per domain (field-level, most
 * specific wins):
 *
 *   code defaults ⇐ 'default' profile ⇐ store's profile ⇐ store overrides
 *
 * Every field is optional at every layer — a layer only speaks about what
 * it wants to change. The resolve helpers collapse the chain into a
 * fully-populated resolved shape.
 *
 * Two field families exist within each domain:
 * - PROCESS settings (lead times, sort algorithm): hydrated/captured onto
 *   the aggregate at intake — retunes affect new work only.
 * - OBSERVATION settings (flightboard SLAs): resolved LIVE at read time —
 *   retuning a threshold re-evaluates everything in flight immediately.
 */
export const StoreSettingsDomainSchema = z.enum(['pick', 'transport']);
export type StoreSettingsDomain = z.infer<typeof StoreSettingsDomainSchema>;

// ── PICK domain ────────────────────────────────────────────────────────────

/**
 * Packing sub-mode the station STARTS each pick in (docs/picking-workflow.md
 * "Packing sub-modes"): 'bags' = scan bag barcodes + attributes only;
 * 'items' = every picked unit assigned into a package. The picker can still
 * switch per pick — this only sets the default.
 */
export const PickPackMode = z.enum(['bags', 'items']);
export type PickPackMode = z.infer<typeof PickPackMode>;

export const PickStoreSettingsSchema = z
  .object({
    /** Minutes before slotStart that DELIVERY parts release to picking. */
    pickLeadTimeMinutesDelivery: z.number().int().min(0).max(1440).optional(),
    /** Minutes before slotStart that COLLECT parts release to picking. */
    pickLeadTimeMinutesCollect: z.number().int().min(0).max(1440).optional(),
    /** Flightboard: a requested pick unclaimed longer than this is late. */
    pickClaimSlaMinutes: z.number().int().min(1).max(1440).optional(),
    /** Flightboard: unclaimed with less than this to slot start is urgent. */
    pickClaimUrgentBeforeSlotMinutes: z.number().int().min(0).max(1440).optional(),
    /** Flightboard: claimed but incomplete with less than this to slot start is late. */
    pickingDeadlineBeforeSlotMinutes: z.number().int().min(0).max(1440).optional(),
    /** Flightboard: a pending part this long past releaseAt means the release cron missed it. */
    releaseOverdueMinutes: z.number().int().min(1).max(120).optional(),
    /**
     * PROCESS setting: how the station orders pick lines. CAPTURED onto the
     * pick at intake — retunes affect new picks only, never a picker
     * mid-trolley. 'temperature-zone' = ambient → chilled → frozen → hot,
     * walk order within each band.
     */
    pickSortAlgorithm: PickSortAlgorithm.optional(),
    /**
     * PROCESS setting: the packing sub-mode the station defaults each pick
     * to (the picker can still switch per pick). Resolved LIVE via
     * /pick-station-settings — retunes reach the station on its next visit.
     */
    defaultPackMode: PickPackMode.optional(),
    /**
     * PER-SIZE overlay on the client's bag program (docs/bag-sizing.md) —
     * a store stocking different bags redefines whole sizes here.
     */
    bagSpecs: BagSpecsSchema.optional(),
    /** Default bag construction per temperature square (picker can override). */
    constructionByTemperature: ConstructionByTemperatureSchema.optional(),
  })
  .strict();

export type PickStoreSettings = z.infer<typeof PickStoreSettingsSchema>;

export type ResolvedPickStoreSettings = {
  [K in keyof Omit<
    PickStoreSettings,
    'bagSpecs' | 'constructionByTemperature'
  >]-?: NonNullable<PickStoreSettings[K]>;
} & {
  bagSpecs: ResolvedBagSpecs;
  constructionByTemperature: ResolvedConstructionByTemperature;
};

export const PICK_SETTINGS_DEFAULTS: ResolvedPickStoreSettings = {
  pickLeadTimeMinutesDelivery: 90,
  pickLeadTimeMinutesCollect: 60,
  pickClaimSlaMinutes: 15,
  pickClaimUrgentBeforeSlotMinutes: 45,
  pickingDeadlineBeforeSlotMinutes: 15,
  releaseOverdueMinutes: 2,
  pickSortAlgorithm: 'walk-sequence',
  defaultPackMode: 'bags',
  bagSpecs: resolveBagSpecs(),
  constructionByTemperature: resolveConstructionByTemperature(),
};

// ── TRANSPORT domain ───────────────────────────────────────────────────────

/** One allowed transport provider at a store, in resolver preference order. */
export const TransportProviderEntrySchema = z
  .object({
    /** Provider adapter code ('own', 'uber', 'epod', 'inmotion', …). */
    code: z.string().min(1).max(32),
    /**
     * Coverage oracle v1: dropoffs within this radius (km) of the store are
     * serviceable by this provider. Absent = unlimited.
     */
    serviceRadiusKm: z.number().positive().max(1000).optional(),
    /** Provider-specific blob (Uber external store id, depot code, zone…). */
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type TransportProviderEntry = z.infer<typeof TransportProviderEntrySchema>;

/**
 * How planned trips reach drivers (Andrew, 2026-07-13 — locked): a NAMED
 * STRATEGY behind one port. 'claim' (default) = the offer/claim marketplace
 * both our execution app and EPOD consume. Future: 'assign' (dispatcher-
 * directed), 'auto-assign', 'broadcast'.
 */
export const TransportAllocationStrategySchema = z.enum(['claim']);
export type TransportAllocationStrategy = z.infer<typeof TransportAllocationStrategySchema>;

export const TransportStoreSettingsSchema = z
  .object({
    /** The execution system transport defaults to for this store. */
    defaultExecutionSystem: z.string().min(1).max(32).optional(),
    /** ALTERNATIVE execution systems allowed at this store (codes like 'epod', 'own'). */
    executionSystems: z.array(z.string().min(1).max(32)).max(20).optional(),
    /** STANDARD service level requests transport at slotStart − this. */
    transportLeadTimeMinutes: z.number().int().min(0).max(1440).optional(),
    /** Provider the resolver ranks first when it is a candidate. */
    defaultTransportProvider: z.string().min(1).max(32).optional(),
    /** Ordered allowed providers (resolver candidates), with per-provider config. */
    transportProviders: z.array(TransportProviderEntrySchema).max(10).optional(),
    /** How planned trips reach drivers at this store. */
    allocationStrategy: TransportAllocationStrategySchema.optional(),
    /**
     * Planning v1 capacity caps (SIMPLE CAPS ONLY — no vehicle registry;
     * Andrew, 2026-07-13). Stops = dropoffs per trip; bags = total parcels.
     */
    maxStopsPerTrip: z.number().int().min(1).max(10).optional(),
    maxBagsPerTrip: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type TransportStoreSettings = z.infer<typeof TransportStoreSettingsSchema>;

export type ResolvedTransportStoreSettings = {
  [K in keyof Omit<
    TransportStoreSettings,
    'defaultExecutionSystem' | 'defaultTransportProvider'
  >]-?: NonNullable<TransportStoreSettings[K]>;
} & {
  readonly defaultExecutionSystem: string | null;
  readonly defaultTransportProvider: string | null;
};

export const TRANSPORT_SETTINGS_DEFAULTS: ResolvedTransportStoreSettings = {
  defaultExecutionSystem: null,
  executionSystems: [],
  transportLeadTimeMinutes: 45,
  defaultTransportProvider: null,
  transportProviders: [],
  allocationStrategy: 'claim',
  maxStopsPerTrip: 3,
  maxBagsPerTrip: 12,
};

// ── Shared resolution ──────────────────────────────────────────────────────

/** The reserved profile every store links to unless assigned otherwise. */
export const DEFAULT_STORE_PROFILE_CODE = 'default';

/**
 * Collapse override layers onto defaults; later layers win per field. Values
 * are heterogeneous (numbers, arrays, strings, objects) — a defined layer
 * value always wins WHOLESALE for its field (arrays replace, never merge).
 */
function resolveLayers<R extends object>(
  defaults: R,
  layers: ReadonlyArray<object | null | undefined>,
): R {
  const resolved = { ...defaults };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) {
        (resolved as Record<string, unknown>)[key] = value;
      }
    }
  }
  return resolved;
}

export function resolvePickStoreSettings(
  ...layers: ReadonlyArray<PickStoreSettings | null | undefined>
): ResolvedPickStoreSettings {
  const resolved = resolveLayers(PICK_SETTINGS_DEFAULTS, layers);
  // Bag specs + construction maps merge PER KEY across layers (wholesale
  // field replacement would drop the sizes a sparse overlay didn't name).
  resolved.bagSpecs = resolveBagSpecs(
    ...layers.map((l) => l?.bagSpecs as BagSpecs | undefined),
  );
  resolved.constructionByTemperature = resolveConstructionByTemperature(
    ...layers.map((l) => l?.constructionByTemperature as ConstructionByTemperature | undefined),
  );
  return resolved;
}

export function resolveTransportStoreSettings(
  ...layers: ReadonlyArray<TransportStoreSettings | null | undefined>
): ResolvedTransportStoreSettings {
  return resolveLayers(TRANSPORT_SETTINGS_DEFAULTS, layers);
}
