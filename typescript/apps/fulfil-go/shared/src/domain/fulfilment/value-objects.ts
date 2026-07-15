import { z } from 'zod';

/**
 * Captured location value objects — the fulfilment carries everything the
 * process needs, as received (often shaped/trimmed/enriched by the creating
 * integration; deliberately NOT called snapshots). Master data is referenced
 * but never relied on after creation.
 */
export const GeoPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const AddressSchema = z
  .object({
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
    suburb: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    region: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    countryCode: z.string().length(2),
  })
  .strict();
export type Address = z.infer<typeof AddressSchema>;

export const ContactSchema = z
  .object({
    name: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().max(200).optional(),
  })
  .strict();
export type Contact = z.infer<typeof ContactSchema>;

export const LocationSchema = z
  .object({
    /** Stable external reference for the place (store id, address id, …). */
    ref: z.string().min(1).max(64).optional(),
    name: z.string().max(200).optional(),
    address: AddressSchema,
    geo: GeoPointSchema.optional(),
    contact: ContactSchema.optional(),
    /** Free-text access/collection instructions. */
    instructions: z.string().max(2000).optional(),
  })
  .strict();
export type Location = z.infer<typeof LocationSchema>;

/**
 * A part's origin (the store). `ref` is required — it scopes short-id
 * allocation and keys the pick request to a store.
 */
export const OriginLocationSchema = LocationSchema.extend({
  ref: z.string().min(1).max(64),
});
export type OriginLocation = z.infer<typeof OriginLocationSchema>;

/**
 * Volumetrics as received on the fulfilment. Weight is AUTHORITATIVE for the
 * whole chain — substitutes are treated as volumetrically identical, packing
 * units come later from standard sizes chosen during pick, but weight always
 * comes from here. Units are explicit in the field names.
 */
export const VolumetricSchema = z
  .object({
    weightGrams: z.number().int().nonnegative(),
    lengthMm: z.number().int().positive().optional(),
    widthMm: z.number().int().positive().optional(),
    heightMm: z.number().int().positive().optional(),
  })
  .strict();
export type Volumetric = z.infer<typeof VolumetricSchema>;

/**
 * Temperature class of a product — informs the pick context's packaging
 * requirements (frozen/chilled lines need appropriate packing units; hot
 * lines are warm prepared food/coffee, kept apart and picked last).
 * Terminology is ambient/chilled/frozen/hot chain-wide (Andrew, 2026-07-13
 * added 'hot').
 */
export const TemperatureClass = z.enum(['ambient', 'chilled', 'frozen', 'hot']);
export type TemperatureClass = z.infer<typeof TemperatureClass>;

/**
 * In-store shelf location for a line — first-class PROCESS INPUT (the pick
 * sort algorithms read it), unlike the free-form `attributes` bag which stays
 * as-received reference data. Every field optional: integrations send what
 * their slotting/planogram data has. `shelf` accepts string or int upstream
 * and normalizes to string. Flows fulfilment line → pick line at intake.
 */
export const FulfilmentLineLocationSchema = z
  .object({
    aisle: z.string().min(1).max(32).optional(),
    bay: z.string().min(1).max(32).optional(),
    shelf: z
      .union([z.string().min(1).max(32), z.number().int().nonnegative()])
      .transform((value) => String(value))
      .optional(),
    /** Position within the shelf/bay — the finest ordering grain. */
    positionIndex: z.number().int().nonnegative().optional(),
    /** Absolute store-walk ordinal (planogram walk order), when known. */
    walkSequence: z.number().int().nonnegative().optional(),
    /** Ready-to-show label; stations prefer it over composing the parts. */
    locationDisplay: z.string().min(1).max(120).optional(),
  })
  .strict();
export type FulfilmentLineLocation = z.infer<typeof FulfilmentLineLocationSchema>;

/** A fulfilment line: immutable value object owned by exactly one part. */
export const FulfilmentLineSchema = z
  .object({
    /** Upstream line id — outcome reporting keys back on this. */
    externalLineRef: z.string().min(1).max(128),
    sku: z.string().min(1).max(64),
    gtin: z.string().max(14).optional(),
    description: z.string().min(1).max(500),
    imageUrl: z.string().max(1000).optional(),
    quantity: z.number().int().min(1),
    volumetric: VolumetricSchema,
    temperatureClass: TemperatureClass.default('ambient'),
    /**
     * Age-restricted product (liquor, tobacco, …): minimum buyer age.
     * PROCESS INPUT (unlike `attributes`): the fulfilment stamps
     * max(restrictedMinAge) at creation and the delivery leg must verify it
     * (docs/handover-verification.md).
     */
    restrictedMinAge: z.number().int().min(1).max(99).optional(),
    /** Overrides the fulfilment-level allowSubstitutes default when present. */
    allowSubstitutes: z.boolean().optional(),
    /** In-store shelf location — drives the station's pick sort when present. */
    location: FulfilmentLineLocationSchema.optional(),
    /** Product attributes as received — reference data, not process input. */
    attributes: z.record(z.string().max(64), z.string().max(500)).optional(),
  })
  .strict();
export type FulfilmentLine = z.infer<typeof FulfilmentLineSchema>;

export const FulfilmentType = z.enum(['delivery', 'collect']);
export type FulfilmentType = z.infer<typeof FulfilmentType>;

export const ServiceLevel = z.enum(['ASAP', 'STANDARD']);
export type ServiceLevel = z.infer<typeof ServiceLevel>;

/**
 * Destination, discriminated to match the fulfilment type. `collect` points
 * at a collection point — a real entity associated (many-to-many) with
 * stores, so a multi-part fulfilment still has one destination. Validation
 * that the collection point serves the origin stores happens upstream at
 * creation-request time.
 */
export const DestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('delivery'), location: LocationSchema }).strict(),
  z
    .object({
      kind: z.literal('collect'),
      collectionPointRef: z.string().min(1).max(64),
      location: LocationSchema,
    })
    .strict(),
]);
export type Destination = z.infer<typeof DestinationSchema>;

/**
 * One promise, expressed at two levels: `allowPartialFulfilment=false` means
 * all-or-nothing — short picks are unacceptable (the pick context's
 * requireFullPick is hydrated as its negation at the boundary) AND any part
 * failure fails the whole fulfilment.
 */
export const FulfilmentPoliciesSchema = z
  .object({
    allowSubstitutes: z.boolean(),
    allowPartialFulfilment: z.boolean(),
  })
  .strict();
export type FulfilmentPolicies = z.infer<typeof FulfilmentPoliciesSchema>;

/**
 * HANDOVER POLICY STAMP (docs/handover-verification.md): the client's
 * fulfilment settings resolved at creation, immutable thereafter — the
 * processDefinition pattern. Pin VALUES live on the aggregate (root
 * deliveryPin, part pickupPin) and never ride events or the driver app.
 */
export const HandoverPolicySchema = z
  .object({
    pickupPinEnabled: z.boolean(),
    /** LEGACY boolean view (pre-deliveryProof stamps) — derives from the enum. */
    deliveryPinEnabled: z.boolean(),
    /** Customer-handover proof: none | pin | picture. Absent on old stamps. */
    deliveryProof: z.enum(['none', 'pin', 'picture']).optional(),
    deliveryPinSource: z.enum(['random', 'phone-last4']),
    /** Driver may attest "visibly older" instead of an ID check. */
    ageVisualOverrideAllowed: z.boolean(),
  })
  .strict();
export type HandoverPolicy = z.infer<typeof HandoverPolicySchema>;

/** Old stamps carry only the boolean — normalize on read, never rewrite. */
export function handoverDeliveryProof(
  policy: HandoverPolicy | null,
): 'none' | 'pin' | 'picture' {
  if (!policy) return 'none';
  return policy.deliveryProof ?? (policy.deliveryPinEnabled ? 'pin' : 'none');
}

/** Pinpoint provenance — creation-time reference only, not process input. */
export const ProvenanceSchema = z
  .object({
    fulfilmentProductId: z.string().max(64).optional(),
    deliveryAreaId: z.string().max(64).optional(),
    serviceAreaId: z.string().max(64).optional(),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Opaque pass-through cargo for the integration chain. Never read by process
 * logic — hygiene limits only.
 */
export const AdditionalDataSchema = z
  .record(z.string().regex(/^[\w.-]{1,64}$/), z.string().max(1024))
  .refine((data) => Object.keys(data).length <= 50, {
    message: 'additionalData is limited to 50 entries',
  });
export type AdditionalData = z.infer<typeof AdditionalDataSchema>;

export const FulfilmentStatus = z.enum([
  'created',
  'in_progress',
  'ready',
  'completing',
  'completed',
  'partially_completed',
  'failed',
  'cancelling',
  'cancelled',
]);
export type FulfilmentStatus = z.infer<typeof FulfilmentStatus>;

export const PartStatus = z.enum([
  'pending',
  'pick_requested',
  'picking',
  'picked',
  'short_picked',
  'ready',
  'handed_over',
  'completed',
  'failed',
  'cancelled',
]);
export type PartStatus = z.infer<typeof PartStatus>;
