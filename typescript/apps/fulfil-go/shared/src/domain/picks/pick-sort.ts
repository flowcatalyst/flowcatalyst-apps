import { z } from 'zod';

/**
 * Pick sort algorithms (docs/picking-workflow.md "Line locations & pick
 * sort"). A STORE-SETTINGS field, CAPTURED onto each pick at intake — config
 * retunes affect new picks only; a picker mid-trolley is never resorted.
 */
export const PickSortAlgorithm = z.enum([
  'walk-sequence',
  'aisle-bay-shelf',
  'temperature-zone',
  'as-received',
]);
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
  /** Product temperature class — drives the 'temperature-zone' algorithm. */
  readonly temperatureClass?: string | null | undefined;
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
 * Temperature band order for 'temperature-zone' (Andrew, 2026-07-13):
 * ambient first (longest safe out of temperature control), then chilled,
 * then frozen (least time out of the freezer), then HOT last so warm
 * prepared food/coffee is still hot at handover. Unknown classes sort with
 * ambient — a missing class must never push a line to the end of the walk.
 */
const TEMPERATURE_BAND: Record<string, number> = {
  ambient: 0,
  chilled: 1,
  frozen: 2,
  hot: 3,
};

function temperatureBand(line: SortablePickLine): number {
  return TEMPERATURE_BAND[line.temperatureClass ?? 'ambient'] ?? 0;
}

/**
 * Sort pick lines for the station, per the pick's captured algorithm:
 *
 * - `walk-sequence`: walkSequence (nulls LAST) → aisle → bay → shelf →
 *   positionIndex → original order. Degrades to aisle-only ordering when
 *   only aisle data exists (today's behaviour).
 * - `aisle-bay-shelf`: pure location ordering — walkSequence ignored.
 * - `temperature-zone`: temperature band (ambient → chilled → frozen → hot),
 *   walk-sequence order WITHIN each band — the per-store choice for stores
 *   without in-aisle cold fixtures; others keep 'walk-sequence'.
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
  const walkOrdered = algorithm === 'walk-sequence' || algorithm === 'temperature-zone';
  decorated.sort(
    (a, b) =>
      (algorithm === 'temperature-zone' ? temperatureBand(a.line) - temperatureBand(b.line) : 0) ||
      (walkOrdered
        ? compareNullableNumber(a.line.location?.walkSequence, b.line.location?.walkSequence)
        : 0) ||
      compareByLocation(a.line, b.line) ||
      a.index - b.index,
  );
  return decorated.map((d) => d.line);
}
