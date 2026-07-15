import { z } from 'zod';
import {
  BagSpecsSchema,
  resolveBagSpecs,
  type BagSpecs,
  type ResolvedBagSpecs,
} from '../stores/bag-specs.contract.js';

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

/**
 * FULFILMENT-domain client config (docs/handover-verification.md): handover
 * pins + age-check policy. Resolved and STAMPED onto each fulfilment at
 * creation (the processDefinition pattern) — reconfiguring migrates NEW
 * fulfilments only. Sparse: absent fields fall through to the defaults.
 */
/** Customer-handover proof mode (docs/handover-verification.md). */
export const DeliveryProofSchema = z.enum(['none', 'pin', 'picture', 'signature']);
export type DeliveryProof = z.infer<typeof DeliveryProofSchema>;

export const FulfilmentClientSettingsSchema = z
  .object({
    /** Generate a per-part pickup PIN (driver↔store handover override). */
    pickupPinEnabled: z.boolean().optional(),
    /**
     * LEGACY boolean — superseded by `deliveryProof` (true→'pin',
     * false→'none'); still accepted as input, ignored when deliveryProof
     * is set.
     */
    deliveryPinEnabled: z.boolean().optional(),
    /** What the driver must capture at the door: none | pin | picture. */
    deliveryProof: DeliveryProofSchema.optional(),
    /**
     * 'phone-last4' uses destination.contact.phone's last 4 digits and
     * FALLS BACK to random when no phone is captured (phone is optional).
     */
    deliveryPinSource: z.enum(['random', 'phone-last4']).optional(),
    /**
     * Permit the driver's "visibly older" attestation instead of an ID
     * check on age-restricted deliveries. OFF unless the client opts in.
     */
    ageVisualOverrideAllowed: z.boolean().optional(),
    /**
     * Restricted deliveries must PHOTOGRAPH the government-issued ID
     * (Andrew, 2026-07-15) — stored via the blob store. OFF by default
     * (POPIA: ID photos are sensitive; retention is the client's call).
     */
    ageIdPhotoRequired: z.boolean().optional(),
  })
  .strict();
export type FulfilmentClientSettings = z.infer<typeof FulfilmentClientSettingsSchema>;

export const ClientSettingsSchema = z
  .object({
    /** Core process definition code (registry key, kebab-case). */
    processDefinition: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .optional(),
    /** Handover pins + age-check policy (stamped at fulfilment creation). */
    fulfilment: FulfilmentClientSettingsSchema.optional(),
    /** Transport capacity vocabulary — codes unique. */
    vehicleClasses: z
      .array(VehicleClassSchema)
      .max(20)
      .refine((v) => new Set(v.map((c) => c.code)).size === v.length, {
        message: 'vehicle class codes must be unique',
      })
      .optional(),
    /**
     * LEGACY size→units map — ABSORBED by bagSpecs (docs/bag-sizing.md).
     * Still accepted as input: it overlays the resolved bagSpecs' units.
     * New config should set bagSpecs instead.
     */
    packageUnitSizes: PackageUnitSizesSchema.optional(),
    /**
     * The client's BAG PROGRAM (docs/bag-sizing.md): per size code, real
     * dimensions + capacity units. Pick store profiles overlay per size.
     */
    bagSpecs: BagSpecsSchema.optional(),
  })
  .strict();

export type ClientSettings = z.infer<typeof ClientSettingsSchema>;

export type ResolvedFulfilmentClientSettings = {
  [K in keyof FulfilmentClientSettings]-?: NonNullable<FulfilmentClientSettings[K]>;
};

export type ResolvedClientSettings = {
  [K in keyof Omit<ClientSettings, 'fulfilment' | 'bagSpecs'>]-?: NonNullable<ClientSettings[K]>;
} & { fulfilment: ResolvedFulfilmentClientSettings; bagSpecs: ResolvedBagSpecs };

/** The registry code every client coordinates with unless configured otherwise. */
export const STANDARD_PROCESS_DEFINITION = 'standard';

export const DEFAULT_PACKAGE_UNIT_SIZES: Record<string, number> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 6,
};

export const FULFILMENT_CLIENT_SETTINGS_DEFAULTS: ResolvedFulfilmentClientSettings = {
  pickupPinEnabled: true,
  deliveryPinEnabled: true,
  deliveryProof: 'pin',
  deliveryPinSource: 'random',
  ageVisualOverrideAllowed: false,
  ageIdPhotoRequired: false,
};

export const CLIENT_SETTINGS_DEFAULTS: ResolvedClientSettings = {
  processDefinition: STANDARD_PROCESS_DEFINITION,
  vehicleClasses: [],
  packageUnitSizes: DEFAULT_PACKAGE_UNIT_SIZES,
  fulfilment: FULFILMENT_CLIENT_SETTINGS_DEFAULTS,
  bagSpecs: resolveBagSpecs(),
};

/** Collapse the client's row (if any) onto the code defaults. */
export function resolveClientSettings(
  settings: ClientSettings | null | undefined,
): ResolvedClientSettings {
  const resolved: ResolvedClientSettings = { ...CLIENT_SETTINGS_DEFAULTS };
  if (settings) {
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined || key === 'fulfilment' || key === 'bagSpecs') continue;
      (resolved as Record<string, unknown>)[key] = value;
    }
    // Section merge: a sparse fulfilment object keeps unset fields on defaults.
    if (settings.fulfilment) {
      resolved.fulfilment = { ...FULFILMENT_CLIENT_SETTINGS_DEFAULTS };
      for (const [key, value] of Object.entries(settings.fulfilment)) {
        if (value !== undefined) {
          (resolved.fulfilment as Record<string, unknown>)[key] = value;
        }
      }
      // Legacy deliveryPinEnabled honoured only when deliveryProof is unset.
      if (settings.fulfilment.deliveryProof === undefined) {
        if (settings.fulfilment.deliveryPinEnabled !== undefined) {
          resolved.fulfilment.deliveryProof = settings.fulfilment.deliveryPinEnabled
            ? 'pin'
            : 'none';
        }
      }
      // The boolean view derives from the enum — no drift.
      resolved.fulfilment.deliveryPinEnabled = resolved.fulfilment.deliveryProof === 'pin';
    }
  }
  // Bag program: defaults ⇐ LEGACY packageUnitSizes (units-only overlay,
  // still accepted) ⇐ bagSpecs. resolved.packageUnitSizes is then DERIVED
  // from the bag specs so units can never drift between the two views.
  const legacyUnitsOverlay: BagSpecs = {};
  if (settings?.packageUnitSizes) {
    for (const [size, units] of Object.entries(settings.packageUnitSizes)) {
      const base = resolveBagSpecs()[size as keyof ResolvedBagSpecs];
      if (base && typeof units === 'number') {
        (legacyUnitsOverlay as Record<string, unknown>)[size] = { ...base, units };
      }
    }
  }
  resolved.bagSpecs = resolveBagSpecs(legacyUnitsOverlay, settings?.bagSpecs);
  resolved.packageUnitSizes = Object.fromEntries(
    Object.entries(resolved.bagSpecs).map(([size, spec]) => [size, spec.units]),
  );
  return resolved;
}
