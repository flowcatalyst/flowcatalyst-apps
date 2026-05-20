/**
 * Branded IDs for the tenancy subdomain. Pinpoint TSIDs use a 3-char prefix
 * + underscore + 13-char TSID payload, matching the `cli_` / `par_` schemes
 * registered with the AggregateRegistry's prefixMap.
 */
export type ClientId = string & { readonly __brand: 'ClientId' };
export type PartitionId = string & { readonly __brand: 'PartitionId' };

export const CLIENT_ID_PREFIX = 'cli' as const;
export const PARTITION_ID_PREFIX = 'par' as const;

export function asClientId(value: string): ClientId {
  return value as ClientId;
}
export function asPartitionId(value: string): PartitionId {
  return value as PartitionId;
}
