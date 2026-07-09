/** Exponential backoff with full jitter: 1s base, doubling, 30s cap. */
export interface Backoff {
  /** Next delay in ms (advances the attempt counter). */
  next(): number;
  reset(): void;
}

export function createBackoff(baseMs = 1_000, capMs = 30_000): Backoff {
  let attempt = 0;
  return {
    next(): number {
      const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
      attempt = Math.min(attempt + 1, 10);
      return Math.floor(Math.random() * ceiling) + baseMs / 2;
    },
    reset(): void {
      attempt = 0;
    },
  };
}
