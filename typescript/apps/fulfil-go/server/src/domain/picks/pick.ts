import type {
  FulfilmentLine,
  FulfilmentType,
  OriginLocation,
  PickSortAlgorithm,
  ServiceLevel,
} from '@fulfil-go/shared';
import type { PickId } from './ids.js';

export const PICK_TYPE = 'Pick' as const;

/**
 * Pick lifecycle: requested → claimed → picked | short_picked | failed.
 * `short_picked` is only reachable when `requireFullPick` is false — the
 * boundary translation of the fulfilment's allowPartialFulfilment policy.
 * With requireFullPick, the picker's only out is an explicit fail (which the
 * future process manager turns into failing the whole fulfilment).
 */
export type PickStatus = 'requested' | 'claimed' | 'picked' | 'short_picked' | 'failed';

/** A replacement item the picker substituted in (captured as scanned —
 * approved-substitute lists arrive with the master-data gateway). */
export interface PickSubstitution {
  readonly barcode: string;
  readonly description: string | null;
  readonly quantity: number;
}

/** What actually got picked, per line — recorded at completion. */
export interface PickLineResult {
  readonly externalLineRef: string;
  /** Units of the ORDERED product picked. */
  readonly pickedQuantity: number;
  /** Replacement units (only when substitution is allowed for the line). */
  readonly substitutions?: readonly PickSubstitution[];
}

/** Ordered-product units + substituted units — the fullness measure. */
export function fulfilledQuantity(result: PickLineResult): number {
  return result.pickedQuantity + (result.substitutions?.reduce((s, x) => s + x.quantity, 0) ?? 0);
}

// Re-exported from the shared contract - a locally re-declared union drifted
// when 'hot' landed chain-wide (2026-07-13); single source of truth now.
export type { PackageSize, PackageTemperature } from '@fulfil-go/shared';
import type { PackageSize, PackageTemperature } from '@fulfil-go/shared';

/**
 * A physical package produced by packing: a scanned bag (size + temperature
 * type) or a loose item marker (things too big/awkward for a bag). `items`
 * is present when the station packed in scan-items-into-bags mode — then the
 * per-line quantities across all packages exactly cover what was picked;
 * bags-only mode records the packages without contents.
 */
export interface PickPackage {
  readonly ref: string;
  readonly kind: 'bag' | 'loose';
  readonly size: PackageSize | null;
  readonly temperature: PackageTemperature;
  readonly items: readonly { externalLineRef: string; quantity: number }[] | null;
}

/**
 * The pick context's work item — one part's pick at one store, created from
 * the fulfilment context's create-pick command (via the platform dispatcher).
 * Carries everything captured on the command; never reads back into the
 * fulfilment aggregate. `storeRef` (= origin.ref) scopes picker visibility
 * and claiming.
 */
export interface Pick {
  readonly id: PickId;
  readonly clientId: string;
  readonly storeRef: string;
  readonly fulfilmentId: string;
  /** Unique per client — the create-pick idempotency key. */
  readonly partId: string;
  readonly shortId: string;
  readonly type: FulfilmentType;
  readonly serviceLevel: ServiceLevel;
  readonly status: PickStatus;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly timezone: string;
  readonly origin: OriginLocation;
  readonly lines: readonly FulfilmentLine[];
  readonly requireFullPick: boolean;
  readonly allowSubstitutes: boolean;
  readonly releasedLate: boolean;
  /** Station line ordering, resolved from the origin store's settings at
   * intake and captured — a config retune never resorts a picker mid-trolley. */
  readonly sortAlgorithm: PickSortAlgorithm;
  /** Picker (pkr_…) who claimed this pick. */
  readonly claimedBy: string | null;
  readonly claimedAt: Date | null;
  /** Per-line outcome, set when the pick completes (picked/short_picked). */
  readonly lineResults: readonly PickLineResult[] | null;
  /** Packing output (bags + loose), when the station packed. */
  readonly packages: readonly PickPackage[] | null;
  /** Picker-supplied at completion: moving this needs a vehicle. Null = unasked. */
  readonly requiresVehicle: boolean | null;
  readonly completedAt: Date | null;
  /** Why the pick failed (picker-supplied), when status = failed. */
  readonly failReason: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePickInput {
  readonly id: PickId;
  readonly clientId: string;
  readonly fulfilmentId: string;
  readonly partId: string;
  readonly shortId: string;
  readonly type: FulfilmentType;
  readonly serviceLevel: ServiceLevel;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly timezone: string;
  readonly origin: OriginLocation;
  readonly lines: readonly FulfilmentLine[];
  readonly requireFullPick: boolean;
  readonly allowSubstitutes: boolean;
  readonly releasedLate: boolean;
  readonly sortAlgorithm: PickSortAlgorithm;
  readonly now: Date;
}

export const Pick = {
  create(input: CreatePickInput): Pick {
    return {
      id: input.id,
      clientId: input.clientId,
      storeRef: input.origin.ref,
      fulfilmentId: input.fulfilmentId,
      partId: input.partId,
      shortId: input.shortId,
      type: input.type,
      serviceLevel: input.serviceLevel,
      status: 'requested',
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      timezone: input.timezone,
      origin: input.origin,
      lines: input.lines,
      requireFullPick: input.requireFullPick,
      allowSubstitutes: input.allowSubstitutes,
      releasedLate: input.releasedLate,
      sortAlgorithm: input.sortAlgorithm,
      claimedBy: null,
      claimedAt: null,
      lineResults: null,
      packages: null,
      requiresVehicle: null,
      completedAt: null,
      failReason: null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /** `requested → claimed`. Guarded by the use case; optimistic lock backstops races. */
  claim(prior: Pick, pickerId: string, now: Date): Pick {
    return {
      ...prior,
      status: 'claimed',
      claimedBy: pickerId,
      claimedAt: now,
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  /** True when every line was fulfilled in full (substitutes count). */
  isFullPick(prior: Pick, results: readonly PickLineResult[]): boolean {
    return prior.lines.every((line) => {
      const result = results.find((r) => r.externalLineRef === line.externalLineRef);
      return result !== undefined && fulfilledQuantity(result) === line.quantity;
    });
  },

  /**
   * `claimed → picked | short_picked` — derived from the line results. The
   * use case guards that short completion is only allowed when
   * `!requireFullPick` and validates packaging; this transition just records
   * the facts.
   */
  complete(
    prior: Pick,
    results: readonly PickLineResult[],
    packages: readonly PickPackage[] | null,
    requiresVehicle: boolean,
    now: Date,
  ): Pick {
    return {
      ...prior,
      status: Pick.isFullPick(prior, results) ? 'picked' : 'short_picked',
      lineResults: results,
      packages,
      requiresVehicle,
      completedAt: now,
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  /** `claimed → failed` — the picker cannot fulfil (out of stock under requireFullPick, etc.). */
  fail(prior: Pick, reason: string, now: Date): Pick {
    return {
      ...prior,
      status: 'failed',
      failReason: reason,
      completedAt: now,
      version: prior.version + 1,
      updatedAt: now,
    };
  },
} as const;
