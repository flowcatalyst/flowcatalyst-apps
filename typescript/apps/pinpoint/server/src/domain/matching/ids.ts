/**
 * Branded IDs for the matching subdomain. `mcf_` for MatchingConfig —
 * registered with the AggregateRegistry prefix map.
 *
 * The seeded global default config uses the fixed id `mcf_GLOBAL_DEFAULT`
 * (not a TSID); per-(client/partition) configs created by `update-matching-
 * config` get TSID-generated ids.
 */
export type MatchingConfigId = string & { readonly __brand: 'MatchingConfigId' };

export const MATCHING_CONFIG_ID_PREFIX = 'mcf' as const;
export const MATCHING_CONFIG_GLOBAL_DEFAULT_ID = 'mcf_GLOBAL_DEFAULT' as const;

export function asMatchingConfigId(value: string): MatchingConfigId {
  return value as MatchingConfigId;
}
