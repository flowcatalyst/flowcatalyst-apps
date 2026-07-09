/**
 * Thrown by repository persist when an optimistic-lock version check fails
 * (UPDATE … WHERE version = expected matched no row). The tx rolls back;
 * the server's error handler maps it to HTTP 409. Every fulfil-go domain
 * operation uses optimistic locking — aggregates carry a `version` bumped
 * on each transition, and persist guards on the prior version.
 */
export class ConcurrencyConflictError extends Error {
  readonly code = 'CONCURRENT_MODIFICATION';

  constructor(aggregateType: string, id: string, expectedVersion: number) {
    super(
      `${aggregateType} '${id}' was modified concurrently (expected version ${expectedVersion}).`,
    );
    this.name = 'ConcurrencyConflictError';
  }
}
