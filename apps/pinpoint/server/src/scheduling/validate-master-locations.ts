/**
 * Batch validation worker — port of Rust
 * `pinpoint-server/src/tasks/validation_worker.rs`.
 *
 * Drains a batch of GEOCODED master_locations and runs
 * `confirm-master-location` on each. The platform fires
 * `pinpoint-validate-master-locations` every 5 minutes (see
 * `flowcatalyst/scheduled-jobs.ts`); each firing processes the current
 * GEOCODED backlog.
 *
 * Per-master error containment: each master is its own `runWrite` tx.
 * One failing confirm does not roll back the others. Failures are
 * recorded in the batch summary so the platform's instance-log surface
 * can see them.
 *
 * Concurrency: the platform's `concurrent: false` flag ensures only
 * one firing runs at a time across replicas. Within a firing the masters
 * process sequentially — confirm is read-heavy (spatial lookup + listing
 * child locations) and writes one outbox row per child, so we keep it
 * sequential to avoid contending on the master row or the outbox shared
 * tables.
 */
import { Result } from 'effect';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../app-context.js';
import { asMasterLocationId } from '../domain/locations/ids.js';

export interface ValidateMasterLocationsBatchResult {
  readonly attempted: number;
  readonly confirmed: number;
  readonly failed: number;
  readonly failures: ReadonlyArray<{
    readonly masterLocationId: string;
    readonly error: string;
  }>;
}

export interface ValidateMasterLocationsBatchConfig {
  /** Max masters to process per firing. Caps the firing duration. Default 100. */
  readonly batchSize?: number;
}

export async function runValidateMasterLocationsBatch(
  appContext: AppContext,
  config: ValidateMasterLocationsBatchConfig = {},
): Promise<ValidateMasterLocationsBatchResult> {
  const batchSize = config.batchSize ?? 100;

  const masters = await appContext.repositories.masterLocations.listByStatus(
    'GEOCODED',
    batchSize,
  );

  const scope = ScopeStore.require();
  const failures: Array<{ masterLocationId: string; error: string }> = [];
  let confirmed = 0;

  for (const master of masters) {
    try {
      const result = await appContext.runWrite(
        appContext.useCases.confirmMasterLocation.execute({
          masterLocationId: master.id,
          clientId: master.clientId,
        }),
        scope,
      );
      if (Result.isFailure(result)) {
        failures.push({
          masterLocationId: master.id,
          error: `${result.failure._tag}:${result.failure.code} ${result.failure.message}`,
        });
        continue;
      }
      confirmed += 1;
    } catch (err) {
      // `runWrite` itself can throw on infra failures (DB tx open,
      // ManagedRuntime errors). Treat the same as a use-case failure
      // — one bad master must not abort the batch.
      failures.push({
        masterLocationId: master.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    attempted: masters.length,
    confirmed,
    failed: failures.length,
    failures,
  };
}
