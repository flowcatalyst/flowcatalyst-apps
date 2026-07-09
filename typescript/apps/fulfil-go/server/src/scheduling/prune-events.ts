import { Cron } from 'croner';
import { lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { idempotencyKeys } from '../infrastructure/schema/idempotency-keys.js';
import { syncEvents } from '../infrastructure/schema/sync-events.js';
import { telemetryLocations } from '../infrastructure/schema/telemetry-locations.js';

const SYNC_EVENTS_RETENTION_DAYS = 7;
const IDEMPOTENCY_RETENTION_DAYS = 7;
const TELEMETRY_RETENTION_DAYS = 30;

interface PruneLogger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function pruneOnce(db: PostgresJsDatabase, log: PruneLogger): Promise<void> {
  // Clients further behind than the sync_events retention window recover via
  // delta sync (GET /sync/jobs), so pruning replay history is safe.
  const [syncPruned, idemPruned, telemetryPruned] = await Promise.all([
    db
      .delete(syncEvents)
      .where(lt(syncEvents.createdAt, daysAgo(SYNC_EVENTS_RETENTION_DAYS)))
      .returning({ id: syncEvents.id }),
    db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, daysAgo(IDEMPOTENCY_RETENTION_DAYS)))
      .returning({ key: idempotencyKeys.key }),
    db
      .delete(telemetryLocations)
      .where(lt(telemetryLocations.createdAt, daysAgo(TELEMETRY_RETENTION_DAYS)))
      .returning({ id: telemetryLocations.id }),
  ]);
  log.info(
    {
      syncEvents: syncPruned.length,
      idempotencyKeys: idemPruned.length,
      telemetryLocations: telemetryPruned.length,
    },
    '[prune] retention sweep done',
  );
}

/** Daily retention sweep at 03:10 server time. Returns the Cron for stop(). */
export function schedulePruneTask(db: PostgresJsDatabase, log: PruneLogger): Cron {
  return new Cron('10 3 * * *', () => {
    pruneOnce(db, log).catch((err) => log.error({ err }, '[prune] retention sweep failed'));
  });
}
