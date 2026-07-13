import { z } from 'zod';

/**
 * Bag-label allocation (docs/bag-label-printing.md). Printing X labels
 * pre-allocates X package refs on the pick; labels are numbered `seq / count`
 * and REFS ARE STABLE PER (pick, seq) — a replace keeps the refs of every
 * kept seq, so bags already scanned into the WIP trolley never migrate.
 */
export const PickLabelSchema = z
  .object({
    /** 1-based label number — the "n" of "n / X". */
    seq: z.number().int().min(1),
    /** Pre-allocated package ref (pkg_… TSID) — the barcode on the label. */
    ref: z.string().min(1).max(64),
    /** Times this label was reprinted (damaged label, same ref/barcode). */
    reprints: z.number().int().min(0),
  })
  .strict();
export type PickLabel = z.infer<typeof PickLabelSchema>;

export const PickLabelAllocationSchema = z
  .object({
    /** Declared bag count X — the active set is seq 1..count. */
    count: z.number().int().min(1),
    labels: z.array(PickLabelSchema).min(1),
    /** Refs dropped by a replace — clients warn when one is scanned. */
    voidedRefs: z.array(z.string()),
  })
  .strict();
export type PickLabelAllocation = z.infer<typeof PickLabelAllocationSchema>;

/**
 * Allocate (no set yet) or REPLACE (set exists) the pick's bag labels to
 * `count`. Same count = idempotent re-render. `printerId` selects the store
 * printer whose label dimensions the ZPL is rendered for; omitted = default
 * dimensions. `clientId`/`pickId` injected from the path.
 */
export const AllocatePickLabelsCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    pickId: z.string().min(1).max(64),
    count: z.number().int().min(1).max(100),
    printerId: z.string().min(1).max(64).optional(),
  })
  .strict();
export type AllocatePickLabelsCommand = z.infer<typeof AllocatePickLabelsCommandSchema>;

/** Reprint ONE damaged label — same ref, same barcode; the reprint is recorded. */
export const ReprintPickLabelCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    pickId: z.string().min(1).max(64),
    seq: z.number().int().min(1),
    printerId: z.string().min(1).max(64).optional(),
  })
  .strict();
export type ReprintPickLabelCommand = z.infer<typeof ReprintPickLabelCommandSchema>;
