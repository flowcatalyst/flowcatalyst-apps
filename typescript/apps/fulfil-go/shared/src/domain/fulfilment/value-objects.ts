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
 * Cold-chain class of a product — informs the pick context's packaging
 * requirements (frozen/refrigerated lines need appropriate packing units).
 */
export const TemperatureClass = z.enum(['normal', 'refrigerated', 'frozen']);
export type TemperatureClass = z.infer<typeof TemperatureClass>;

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
    temperatureClass: TemperatureClass.default('normal'),
    /** Overrides the fulfilment-level allowSubstitutes default when present. */
    allowSubstitutes: z.boolean().optional(),
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
