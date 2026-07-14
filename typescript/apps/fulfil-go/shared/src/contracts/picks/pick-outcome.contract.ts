import { z } from 'zod';

export const PackageSizeSchema = z.enum(['XS', 'S', 'M', 'L', 'XL']);
export type PackageSize = z.infer<typeof PackageSizeSchema>;

export const PackageTemperatureSchema = z.enum(['ambient', 'chilled', 'frozen', 'hot']);
export type PackageTemperature = z.infer<typeof PackageTemperatureSchema>;

/**
 * A packed unit: a bag (scanned barcode + size + temperature type) or a
 * loose-item marker. `items` present = scan-items-into-bags mode (contents
 * known); absent = bags-only mode. All-or-none across a completion.
 */
export const PickPackageSchema = z
  .object({
    /**
     * Barcode as scanned (bag or loose item / printed label stuck on it);
     * generated fallback ref (e.g. loose-1) for loose items with no barcode.
     */
    ref: z.string().min(1).max(64),
    kind: z.enum(['bag', 'loose']),
    size: PackageSizeSchema.nullish(),
    temperature: PackageTemperatureSchema.default('ambient'),
    items: z
      .array(
        z
          .object({
            externalLineRef: z.string().min(1).max(128),
            quantity: z.number().int().min(1),
          })
          .strict(),
      )
      .nullish(),
  })
  .strict()
  .refine((p) => p.kind !== 'bag' || p.size != null, { message: 'A bag requires a size.' });
export type PickPackageInput = z.infer<typeof PickPackageSchema>;

/**
 * Complete a claimed pick with per-line picked quantities. EVERY line of the
 * pick must be present (explicit zeros, no silent omissions); any quantity
 * below the ordered amount makes it a short pick — permitted only when the
 * pick's requireFullPick is false (the fulfilment allowed partial
 * fulfilment). `clientId`/`pickId` injected from the path.
 */
export const CompletePickCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    pickId: z.string().min(1).max(64),
    lines: z
      .array(
        z
          .object({
            externalLineRef: z.string().min(1).max(128),
            /** Units of the ORDERED product picked. */
            pickedQuantity: z.number().int().min(0),
            /**
             * Replacement items (scan-captured; only valid when the line —
             * or the pick's default — allows substitutes).
             */
            substitutions: z
              .array(
                z
                  .object({
                    barcode: z.string().min(1).max(64),
                    description: z.string().max(300).nullish(),
                    quantity: z.number().int().min(1),
                  })
                  .strict(),
              )
              .max(20)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    /** Packing output (pick-then-pack). Omitted = no packing recorded. */
    packages: z.array(PickPackageSchema).min(1).max(100).optional(),
    /**
     * Picker-supplied at completion: does moving this pick need a vehicle?
     * Feeds the transport decision. Default false ("No" is the norm).
     */
    requiresCarOrLarger: z.boolean().default(false),
  })
  .strict();
export type CompletePickCommand = z.infer<typeof CompletePickCommandSchema>;

/** The picker cannot fulfil a claimed pick — reason required. */
export const FailPickCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    pickId: z.string().min(1).max(64),
    reason: z.string().min(1).max(500),
  })
  .strict();
export type FailPickCommand = z.infer<typeof FailPickCommandSchema>;
