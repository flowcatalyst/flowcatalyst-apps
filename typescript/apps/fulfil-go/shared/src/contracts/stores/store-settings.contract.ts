import { z } from 'zod';

/**
 * Operational store settings — the values a STORE PROFILE carries.
 *
 * Layered resolution (field-level, most specific wins):
 *   code defaults ⇐ 'default' profile ⇐ store's profile ⇐ store overrides
 *
 * Every field is optional at every layer — a layer only speaks about what
 * it wants to change. `resolveStoreSettings` collapses the chain into a
 * fully-populated `ResolvedStoreSettings`.
 *
 * Two families live here:
 * - PROCESS settings (pick lead times): hydrated ONTO the fulfilment at
 *   creation when the upstream payload doesn't set them explicitly — an
 *   external system managing its own values just sends them and wins.
 * - OBSERVATION settings (flightboard SLAs): resolved LIVE at read time,
 *   never captured — retuning a threshold re-evaluates everything in
 *   flight immediately.
 */
export const StoreSettingsSchema = z
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
  })
  .strict();

export type StoreSettings = z.infer<typeof StoreSettingsSchema>;
/** All layers collapsed — every field present (Required<> alone keeps the
 *  `| undefined` unions zod's .optional() infers, hence the mapped type). */
export type ResolvedStoreSettings = {
  [K in keyof StoreSettings]-?: NonNullable<StoreSettings[K]>;
};

export const STORE_SETTINGS_DEFAULTS: ResolvedStoreSettings = {
  pickLeadTimeMinutesDelivery: 90,
  pickLeadTimeMinutesCollect: 60,
  pickClaimSlaMinutes: 15,
  pickClaimUrgentBeforeSlotMinutes: 45,
  pickingDeadlineBeforeSlotMinutes: 15,
  releaseOverdueMinutes: 2,
};

/** The reserved profile every store links to unless assigned otherwise. */
export const DEFAULT_STORE_PROFILE_CODE = 'default';

/** Collapse override layers onto the defaults; later layers win per field. */
export function resolveStoreSettings(
  ...layers: ReadonlyArray<StoreSettings | null | undefined>
): ResolvedStoreSettings {
  const resolved: ResolvedStoreSettings = { ...STORE_SETTINGS_DEFAULTS };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) {
        (resolved as Record<string, number>)[key] = value as number;
      }
    }
  }
  return resolved;
}
