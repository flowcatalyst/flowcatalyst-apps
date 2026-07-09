/**
 * Branded IDs for the jobs subdomain. fulfil-go TSIDs use a 3-char prefix +
 * underscore + TSID payload, matching the `job_` scheme registered with the
 * AggregateRegistry's prefixMap.
 */
export type JobId = string & { readonly __brand: 'JobId' };

export const JOB_ID_PREFIX = 'job' as const;

export function asJobId(value: string): JobId {
  return value as JobId;
}
