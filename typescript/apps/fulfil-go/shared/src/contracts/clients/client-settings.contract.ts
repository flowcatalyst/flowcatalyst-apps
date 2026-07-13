import { z } from 'zod';

/**
 * CLIENT-level operational settings (docs/process-definitions.md) — the
 * per-tenant knobs that don't belong to any store. One row per client,
 * every field optional: an absent field means the code default.
 *
 * First resident: `processDefinition` — which CORE PROCESS DEFINITION
 * (registry code) coordinates this client's fulfilments. The resolved code
 * is STAMPED onto each fulfilment at creation; changing it here migrates
 * NEW fulfilments only — in-flight ones finish on their stamped definition
 * (no cutover flag-day).
 */
/**
 * A vehicle CLASS (bike / car / van / …) — client-scoped transport capacity
 * vocabulary (Andrew, 2026-07-13). Capacity is counted in UNITS: each
 * parcel's bag size maps to units via `packageUnitSizes`, and a trip's
 * total units must fit the vehicle class's `maxUnits`. `maxMassKg` is
 * carried for when parcel mass is captured (not enforced yet — picks don't
 * weigh bags).
 */
export const VehicleClassSchema = z
  .object({
    /** Class code — what drivers/vehicles reference ('bike', 'car', 'van'). */
    code: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    name: z.string().min(1).max(80),
    /** Trip capacity in units (see packageUnitSizes). */
    maxUnits: z.number().int().min(1).max(1000),
    /** Reserved: enforced once parcel mass is captured. */
    maxMassKg: z.number().positive().max(50_000).optional(),
  })
  .strict();
export type VehicleClass = z.infer<typeof VehicleClassSchema>;

/** Bag size → units. Sizes absent from the map cost the default (1). */
export const PackageUnitSizesSchema = z.record(
  z.enum(['XS', 'S', 'M', 'L', 'XL']),
  z.number().int().min(1).max(100),
);
export type PackageUnitSizes = z.infer<typeof PackageUnitSizesSchema>;

export const ClientSettingsSchema = z
  .object({
    /** Core process definition code (registry key, kebab-case). */
    processDefinition: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .optional(),
    /** Transport capacity vocabulary — codes unique. */
    vehicleClasses: z
      .array(VehicleClassSchema)
      .max(20)
      .refine((v) => new Set(v.map((c) => c.code)).size === v.length, {
        message: 'vehicle class codes must be unique',
      })
      .optional(),
    /** Bag size → capacity units (XS=1, S=2, … — client-tuned). */
    packageUnitSizes: PackageUnitSizesSchema.optional(),
  })
  .strict();

export type ClientSettings = z.infer<typeof ClientSettingsSchema>;

export type ResolvedClientSettings = {
  [K in keyof ClientSettings]-?: NonNullable<ClientSettings[K]>;
};

/** The registry code every client coordinates with unless configured otherwise. */
export const STANDARD_PROCESS_DEFINITION = 'standard';

export const DEFAULT_PACKAGE_UNIT_SIZES: Record<string, number> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 6,
};

export const CLIENT_SETTINGS_DEFAULTS: ResolvedClientSettings = {
  processDefinition: STANDARD_PROCESS_DEFINITION,
  vehicleClasses: [],
  packageUnitSizes: DEFAULT_PACKAGE_UNIT_SIZES,
};

/** Collapse the client's row (if any) onto the code defaults. */
export function resolveClientSettings(
  settings: ClientSettings | null | undefined,
): ResolvedClientSettings {
  const resolved: ResolvedClientSettings = { ...CLIENT_SETTINGS_DEFAULTS };
  if (settings) {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        (resolved as Record<string, unknown>)[key] = value;
      }
    }
  }
  return resolved;
}
