import { generateTsid } from '@flowcatalyst/sdk';

/**
 * Branded prefixed TSID, following the FlowCatalyst platform convention
 * (`prn_…`, `oac_…`): `${prefix}_${13-char Crockford Base32}`.
 *
 * NOTE: the SDK ships `generateWithPrefix()` in its tsid module but does not
 * (yet) re-export it through the package exports map — this helper mirrors
 * that convention exactly. When the SDK exports it (one-line change in
 * `src/outbox/index.ts`), swap the internals here; call sites won't move.
 */
export type Tsid<Prefix extends string> = `${Prefix}_${string}` & {
  readonly __tsidPrefix: Prefix;
};

/** Generate a new branded TSID for the given prefix, e.g. `brandedTsid('ful')`. */
export function brandedTsid<P extends string>(prefix: P): Tsid<P> {
  return `${prefix}_${generateTsid()}` as Tsid<P>;
}

/** Runtime check that a string carries the expected prefix + payload shape. */
export function isTsid<P extends string>(prefix: P, value: string): value is Tsid<P> {
  return value.startsWith(`${prefix}_`) && value.length === prefix.length + 14;
}

/**
 * Checked cast for values from trusted storage (DB rows). Throws on shape
 * mismatch — for USER input, guard with `isTsid` and return a 404 instead.
 */
export function asTsid<P extends string>(prefix: P, value: string): Tsid<P> {
  if (!value.startsWith(`${prefix}_`)) {
    throw new Error(`expected a '${prefix}_' TSID, got '${value}'`);
  }
  return value as Tsid<P>;
}
