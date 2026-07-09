import { isFailure } from '@fulfil-go/framework';
import type { AppContext } from '../app-context.js';

/**
 * System identity for platform-scheduled work (mirrors pinpoint's shape).
 * The scheduler is platform-driven and pre-authorised — release runs with
 * a SERVICE scope, not a user principal.
 */
export const SystemIdentity = {
  SCHEDULER: {
    principalId: 'fulfil-go:system:scheduler',
  },
} as const;

const BATCH_LIMIT = 200;

export interface ReleaseSweepResult {
  readonly attempted: number;
  readonly released: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failures: readonly { partId: string; error: string }[];
}

/**
 * The release-picks sweep: find pending parts whose releaseAt has passed and
 * release each one (part → pick_requested + create-pick dispatch job). Dumb
 * reconciler by design — each part releases in its own runWrite tx with
 * per-item error containment, so one store's failure never aborts the batch,
 * and re-runs are naturally idempotent (released parts are no longer
 * pending). Always releases regardless of lateness (late is logged).
 */
export async function runReleasePicksSweep(appContext: AppContext): Promise<ReleaseSweepResult> {
  const due = await appContext.repositories.fulfilments.listDueParts(new Date(), BATCH_LIMIT);

  let released = 0;
  let skipped = 0;
  const failures: { partId: string; error: string }[] = [];

  for (const ref of due) {
    try {
      const result = await appContext.runWrite(() =>
        appContext.useCases.releasePartForPick.execute(ref),
      );
      if (isFailure(result)) {
        // A racing sweep/cancel got there first — business-rule outcomes are
        // expected under concurrency, not failures.
        if (result.error.type === 'business_rule' || result.error.type === 'not_found') {
          skipped += 1;
        } else {
          failures.push({ partId: ref.partId, error: `${result.error.code}` });
        }
      } else {
        released += 1;
      }
    } catch (err) {
      failures.push({
        partId: ref.partId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    attempted: due.length,
    released,
    skipped,
    failed: failures.length,
    failures,
  };
}
