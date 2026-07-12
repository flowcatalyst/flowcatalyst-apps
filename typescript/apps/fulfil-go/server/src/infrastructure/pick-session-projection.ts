import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import type { Pick } from '../domain/picks/pick.js';
import { pickSessions } from './schema/pick-sessions.js';

/**
 * pick_sessions projection writer (docs/projections.md). Called by the pick
 * use cases INSIDE their runWrite — every write joins the ambient tx (a
 * bare pool write here would both break atomicity and risk the pool
 * self-deadlock). Full-row upsert derived from the aggregate, so replays
 * and out-of-order arrivals are idempotent by construction.
 */
export interface PickSessionProjection {
  upsert(pick: Pick): Promise<void>;
}

function unitsTotal(pick: Pick): number {
  return pick.lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function createPickSessionProjection(db: PostgresJsDatabase): PickSessionProjection {
  return {
    async upsert(pick: Pick): Promise<void> {
      const client = resolveDb(db, TransactionStore.require());
      const now = new Date();
      const terminal =
        pick.status === 'picked' || pick.status === 'short_picked' || pick.status === 'failed';
      const completedAt = terminal ? (pick.completedAt ?? now) : null;
      const unitsPicked = pick.lineResults?.reduce((sum, r) => sum + r.pickedQuantity, 0) ?? null;
      const unitsSubstituted =
        pick.lineResults?.reduce(
          (sum, r) => sum + (r.substitutions?.reduce((s, x) => s + x.quantity, 0) ?? 0),
          0,
        ) ?? null;
      const values = {
        pickId: pick.id as string,
        clientId: pick.clientId,
        storeRef: pick.storeRef,
        fulfilmentId: pick.fulfilmentId,
        partId: pick.partId,
        shortId: pick.shortId,
        serviceLevel: pick.serviceLevel,
        requireFullPick: pick.requireFullPick,
        slotStart: pick.slotStart,
        releasedLate: pick.releasedLate,
        requestedAt: pick.createdAt,
        claimedAt: pick.claimedAt,
        completedAt,
        pickerId: pick.claimedBy,
        handlingSeconds:
          completedAt && pick.claimedAt
            ? Math.max(0, Math.round((completedAt.getTime() - pick.claimedAt.getTime()) / 1000))
            : null,
        outcome: terminal ? pick.status : null,
        failReason: pick.failReason,
        linesTotal: pick.lines.length,
        unitsTotal: unitsTotal(pick),
        unitsPicked,
        unitsSubstituted,
        packagesCount: pick.packages?.length ?? null,
        bagSizes: pick.packages?.map((p) => p.size).filter(Boolean) ?? null,
        requiresVehicle: pick.requiresVehicle,
        onTime: completedAt ? completedAt.getTime() <= pick.slotStart.getTime() : null,
        inFull: terminal ? pick.status === 'picked' : null,
        updatedAt: now,
      };
      await client
        .insert(pickSessions)
        .values(values)
        .onConflictDoUpdate({ target: pickSessions.pickId, set: values });
    },
  };
}
