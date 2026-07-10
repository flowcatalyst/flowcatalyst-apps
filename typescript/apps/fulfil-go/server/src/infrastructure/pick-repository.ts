import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import { ConcurrencyConflictError } from '@fulfil-go/framework';
import type {
  FulfilmentLine,
  FulfilmentType,
  OriginLocation,
  ServiceLevel,
} from '@fulfil-go/shared';
import { asPickId, type PickId } from '../domain/picks/ids.js';
import {
  PICK_TYPE,
  type Pick,
  type PickLineResult,
  type PickStatus,
} from '../domain/picks/pick.js';
import type { PickRepository } from '../domain/picks/pick.repository.js';
import { picks, type PickRow } from './schema/picks.js';

function toDomain(row: PickRow): Pick {
  return {
    id: asPickId(row.id),
    clientId: row.clientId,
    storeRef: row.storeRef,
    fulfilmentId: row.fulfilmentId,
    partId: row.partId,
    shortId: row.shortId,
    type: row.type as FulfilmentType,
    serviceLevel: row.serviceLevel as ServiceLevel,
    status: row.status as PickStatus,
    slotStart: row.slotStart,
    slotEnd: row.slotEnd,
    timezone: row.timezone,
    origin: row.origin as OriginLocation,
    lines: row.lines as FulfilmentLine[],
    requireFullPick: row.requireFullPick,
    allowSubstitutes: row.allowSubstitutes,
    releasedLate: row.releasedLate,
    claimedBy: row.claimedBy,
    claimedAt: row.claimedAt,
    lineResults: (row.lineResults as PickLineResult[] | null) ?? null,
    completedAt: row.completedAt,
    failReason: row.failReason,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzlePickRepository(db: PostgresJsDatabase): PickRepository {
  return {
    async persist(aggregate: Pick, tx?: TransactionContext): Promise<Pick> {
      const client = resolveDb(db, tx);
      let row: PickRow | undefined;
      if (aggregate.version === 1) {
        [row] = await client
          .insert(picks)
          .values({
            id: aggregate.id,
            clientId: aggregate.clientId,
            storeRef: aggregate.storeRef,
            fulfilmentId: aggregate.fulfilmentId,
            partId: aggregate.partId,
            shortId: aggregate.shortId,
            type: aggregate.type,
            serviceLevel: aggregate.serviceLevel,
            status: aggregate.status,
            slotStart: aggregate.slotStart,
            slotEnd: aggregate.slotEnd,
            timezone: aggregate.timezone,
            origin: aggregate.origin,
            lines: aggregate.lines,
            requireFullPick: aggregate.requireFullPick,
            allowSubstitutes: aggregate.allowSubstitutes,
            releasedLate: aggregate.releasedLate,
            claimedBy: aggregate.claimedBy,
            claimedAt: aggregate.claimedAt,
            lineResults: aggregate.lineResults,
            completedAt: aggregate.completedAt,
            failReason: aggregate.failReason,
            version: aggregate.version,
            createdAt: aggregate.createdAt,
            updatedAt: aggregate.updatedAt,
          })
          .returning();
      } else {
        // Optimistic locking (house rule): only process state ever changes.
        // No match = a racing claim won — 409 via the server error handler.
        [row] = await client
          .update(picks)
          .set({
            status: aggregate.status,
            claimedBy: aggregate.claimedBy,
            claimedAt: aggregate.claimedAt,
            lineResults: aggregate.lineResults,
            completedAt: aggregate.completedAt,
            failReason: aggregate.failReason,
            version: aggregate.version,
            updatedAt: aggregate.updatedAt,
          })
          .where(and(eq(picks.id, aggregate.id), eq(picks.version, aggregate.version - 1)))
          .returning();
        if (!row) {
          throw new ConcurrencyConflictError(PICK_TYPE, aggregate.id, aggregate.version - 1);
        }
      }
      if (!row) throw new Error(`Pick persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: Pick, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client.delete(picks).where(eq(picks.id, aggregate.id)).returning();
      return rows.length > 0;
    },

    async findById(clientId: string, id: PickId): Promise<Pick | null> {
      const [row] = await db
        .select()
        .from(picks)
        .where(and(eq(picks.clientId, clientId), eq(picks.id, id)))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async findByPartId(clientId: string, partId: string): Promise<Pick | null> {
      const [row] = await db
        .select()
        .from(picks)
        .where(and(eq(picks.clientId, clientId), eq(picks.partId, partId)))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByStore(
      clientId: string,
      storeRef: string,
      status?: PickStatus,
    ): Promise<readonly Pick[]> {
      const conditions = [eq(picks.clientId, clientId), eq(picks.storeRef, storeRef)];
      if (status) conditions.push(eq(picks.status, status));
      const rows = await db
        .select()
        .from(picks)
        .where(and(...conditions))
        .orderBy(asc(picks.slotStart), asc(picks.shortId));
      return rows.map(toDomain);
    },
  };
}
