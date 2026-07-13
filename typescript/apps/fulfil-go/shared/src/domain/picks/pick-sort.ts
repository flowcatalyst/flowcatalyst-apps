import { z } from 'zod';

/**
 * Pick sort algorithms (docs/picking-workflow.md "Line locations & pick
 * sort"). A STORE-SETTINGS field, CAPTURED onto each pick at intake — config
 * retunes affect new picks only; a picker mid-trolley is never resorted.
 */
export const PickSortAlgorithm = z.enum(['walk-sequence', 'aisle-bay-shelf', 'as-received']);
export type PickSortAlgorithm = z.infer<typeof PickSortAlgorithm>;

export const DEFAULT_PICK_SORT_ALGORITHM: PickSortAlgorithm = 'walk-sequence';

/** Structural shape `sortPickLines` reads — matches FulfilmentLineLocation.
 * Explicit `| undefined` keeps it assignable under exactOptionalPropertyTypes. */
export interface PickLineLocationLike {
  readonly aisle?: string | null | undefined;
  readonly bay?: string | null | undefined;
  readonly shelf?: string | null | undefined;
  readonly positionIndex?: number | null | undefined;
  readonly walkSequence?: number | null | undefined;
  readonly locationDisplay?: string | null | undefined;
}

export interface SortablePickLine {
  readonly location?: PickLineLocationLike | null | undefined;
  /** Legacy carrier: pre-location lines put the aisle in attributes.aisle. */
  readonly attributes?: Readonly<Record<string, string>> | null | undefined;
}

/** NATURAL string order ("A2" < "A10"); null/empty sorts LAST. */
function compareNatural(a: string | null | undefined, b: string | null | undefined): number {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

/** Numeric order; null sorts LAST. */
function compareNullableNumber(a: number | null | undefined, b: number | null | undefined): number {
  const aEmpty = a == null;
  const bEmpty = b == null;
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  return a - b;
}

/** The aisle key falls back to legacy `attributes.aisle` when no location. */
function aisleKey(line: SortablePickLine): string | undefined {
  return line.location?.aisle ?? line.attributes?.['aisle'] ?? undefined;
}

function compareByLocation(a: SortablePickLine, b: SortablePickLine): number {
  return (
    compareNatural(aisleKey(a), aisleKey(b)) ||
    compareNatural(a.location?.bay, b.location?.bay) ||
    compareNatural(a.location?.shelf, b.location?.shelf) ||
    compareNullableNumber(a.location?.positionIndex, b.location?.positionIndex)
  );
}

/**
 * Sort pick lines for the station, per the pick's captured algorithm:
 *
 * - `walk-sequence`: walkSequence (nulls LAST) → aisle → bay → shelf →
 *   positionIndex → original order. Degrades to aisle-only ordering when
 *   only aisle data exists (today's behaviour).
 * - `aisle-bay-shelf`: pure location ordering — walkSequence ignored.
 * - `as-received`: upstream line order preserved.
 *
 * STABLE (explicit original-index tiebreak) and pure — always returns a new
 * array, never mutates the input.
 */
export function sortPickLines<T extends SortablePickLine>(
  lines: readonly T[],
  algorithm: PickSortAlgorithm,
): T[] {
  if (algorithm === 'as-received') return [...lines];
  const decorated = lines.map((line, index) => ({ line, index }));
  decorated.sort(
    (a, b) =>
      (algorithm === 'walk-sequence'
        ? compareNullableNumber(a.line.location?.walkSequence, b.line.location?.walkSequence)
        : 0) ||
      compareByLocation(a.line, b.line) ||
      a.index - b.index,
  );
  return decorated.map((d) => d.line);
}
