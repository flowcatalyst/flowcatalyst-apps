import { z } from 'zod';
import { PackageSizeSchema, type PackageSize } from '../picks/pick-outcome.contract.js';

/**
 * BAG SPECS — the client's internal bag program (docs/bag-sizing.md,
 * locked with Andrew 2026-07-14). There is NO industry-wide size standard:
 * on-demand players standardize internally and map at the provider edge,
 * so each size CODE carries real dimensions + the capacity `units` the
 * planner counts (this table ABSORBS packageUnitSizes — one table, no
 * drift). Client settings hold the program; pick store profiles override
 * per size where a store stocks different bags.
 */
export const BagDimsSchema = z
  .object({
    lengthMm: z.number().int().min(10).max(3000),
    widthMm: z.number().int().min(10).max(3000),
    heightMm: z.number().int().min(10).max(3000),
  })
  .strict();
export type BagDims = z.infer<typeof BagDimsSchema>;

export const BagSpecSchema = z
  .object({
    dims: BagDimsSchema,
    maxMassKg: z.number().positive().max(100).optional(),
    /** Trip-capacity units this size costs (vehicle-class maxUnits math). */
    units: z.number().int().min(1).max(100),
  })
  .strict();
export type BagSpec = z.infer<typeof BagSpecSchema>;

/** Partial per-size overlay — a layer only speaks about sizes it changes. */
export const BagSpecsSchema = z
  .object({
    XS: BagSpecSchema.optional(),
    S: BagSpecSchema.optional(),
    M: BagSpecSchema.optional(),
    L: BagSpecSchema.optional(),
    XL: BagSpecSchema.optional(),
  })
  .strict();
export type BagSpecs = z.infer<typeof BagSpecsSchema>;
export type ResolvedBagSpecs = Record<PackageSize, BagSpec>;

/**
 * Tote-anchored strawman defaults (M ≈ the standard grocery tote); units
 * match the historical packageUnitSizes defaults (XS1 S2 M3 L4 XL6).
 */
export const BAG_SPECS_DEFAULTS: ResolvedBagSpecs = {
  XS: { dims: { lengthMm: 250, widthMm: 200, heightMm: 150 }, units: 1 },
  S: { dims: { lengthMm: 300, widthMm: 250, heightMm: 200 }, units: 2 },
  M: { dims: { lengthMm: 400, widthMm: 300, heightMm: 250 }, units: 3 },
  L: { dims: { lengthMm: 450, widthMm: 350, heightMm: 300 }, units: 4 },
  XL: { dims: { lengthMm: 600, widthMm: 400, heightMm: 400 }, units: 6 },
};

/** Per-SIZE merge (a layer redefines whole sizes, never partial specs). */
export function resolveBagSpecs(
  ...layers: ReadonlyArray<BagSpecs | null | undefined>
): ResolvedBagSpecs {
  const resolved: ResolvedBagSpecs = { ...BAG_SPECS_DEFAULTS };
  for (const layer of layers) {
    if (!layer) continue;
    for (const size of Object.keys(resolved) as PackageSize[]) {
      const spec = layer[size];
      if (spec) resolved[size] = spec;
    }
  }
  return resolved;
}

/**
 * BAG CONSTRUCTION (docs/bag-sizing.md): how the bag delivers the
 * temperature the contents need. Industry-aligned naming — the frozen tier
 * is an INSULATED bag plus gel packs, never "a frozen bag".
 */
export const PackageConstructionSchema = z.enum(['standard', 'insulated', 'insulated-gel']);
export type PackageConstruction = z.infer<typeof PackageConstructionSchema>;

/** Default construction per the bag's picker-set TEMPERATURE square. */
export const ConstructionByTemperatureSchema = z
  .object({
    ambient: PackageConstructionSchema.optional(),
    chilled: PackageConstructionSchema.optional(),
    frozen: PackageConstructionSchema.optional(),
    hot: PackageConstructionSchema.optional(),
  })
  .strict();
export type ConstructionByTemperature = z.infer<typeof ConstructionByTemperatureSchema>;
export type ResolvedConstructionByTemperature = Required<ConstructionByTemperature>;

export const CONSTRUCTION_BY_TEMPERATURE_DEFAULTS: ResolvedConstructionByTemperature = {
  ambient: 'standard',
  chilled: 'insulated',
  frozen: 'insulated-gel',
  hot: 'insulated',
};

export function resolveConstructionByTemperature(
  ...layers: ReadonlyArray<ConstructionByTemperature | null | undefined>
): ResolvedConstructionByTemperature {
  const resolved = { ...CONSTRUCTION_BY_TEMPERATURE_DEFAULTS };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [temp, construction] of Object.entries(layer)) {
      if (construction) (resolved as Record<string, string>)[temp] = construction;
    }
  }
  return resolved;
}

const SIZE_ORDER: readonly PackageSize[] = ['XS', 'S', 'M', 'L', 'XL'];

/**
 * Smallest size whose bag CONTAINS the given dimensions (rotation allowed:
 * both dimension sets compare sorted descending). Null when nothing fits —
 * bigger than the largest bag means loose/oversize handling.
 */
export function fitBagSize(
  dims: { lengthMm: number; widthMm: number; heightMm: number },
  specs: ResolvedBagSpecs,
): PackageSize | null {
  const item = [dims.lengthMm, dims.widthMm, dims.heightMm].sort((a, b) => b - a);
  for (const size of SIZE_ORDER) {
    const bag = specs[size].dims;
    const box = [bag.lengthMm, bag.widthMm, bag.heightMm].sort((a, b) => b - a);
    if (item.every((d, i) => d <= (box[i] as number))) return size;
  }
  return null;
}
