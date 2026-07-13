import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import { brandedTsid } from '@fulfil-go/framework';
import { depotStores, depots } from './schema/depots.js';

/**
 * Depots — transport topology REFERENCE DATA (store-registry pattern: plain
 * idempotent upserts, no aggregate/outbox). A depot serves MANY stores via
 * the depot_stores link (no 1:1 depot↔store — Andrew 2026-07-13); drivers
 * are based at depots.
 */
export interface DepotSummary {
  readonly id: string;
  readonly depotRef: string;
  readonly name: string;
  readonly geo: { lat: number; lng: number } | null;
  readonly storeRefs: readonly string[];
}

export interface UpsertDepotInput {
  readonly depotRef: string;
  readonly name: string;
  readonly geo?: { lat: number; lng: number } | null;
  /** Full replacement of the served-stores link set. */
  readonly storeRefs: readonly string[];
}

export interface DepotRepository {
  /** Idempotent upsert keyed on (clientId, depotRef); replaces store links. */
  upsert(clientId: string, input: UpsertDepotInput): Promise<DepotSummary>;
  listByClient(clientId: string): Promise<readonly DepotSummary[]>;
  findByRef(clientId: string, depotRef: string): Promise<DepotSummary | null>;
  /** The offer feed's scope: every store this depot serves. */
  storesForDepot(clientId: string, depotRef: string): Promise<readonly string[]>;
  delete(clientId: string, depotRef: string): Promise<boolean>;
}

export function createDrizzleDepotRepository(db: PostgresJsDatabase): DepotRepository {
  // Reads join the ambient use-case tx (ALS) — pool self-deadlock rule.
  const current = () => resolveDb(db, TransactionStore.get());

  async function linksFor(
    clientId: string,
    depotRefs: readonly string[],
  ): Promise<Map<string, string[]>> {
    if (depotRefs.length === 0) return new Map();
    const rows = await current()
      .select()
      .from(depotStores)
      .where(and(eq(depotStores.clientId, clientId), inArray(depotStores.depotRef, [...depotRefs])))
      .orderBy(asc(depotStores.storeRef));
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.depotRef) ?? [];
      list.push(row.storeRef);
      map.set(row.depotRef, list);
    }
    return map;
  }

  return {
    async upsert(clientId, input): Promise<DepotSummary> {
      const now = new Date();
      const [row] = await current()
        .insert(depots)
        .values({
          id: brandedTsid('dpt'),
          clientId,
          depotRef: input.depotRef,
          name: input.name,
          lat: input.geo?.lat ?? null,
          lng: input.geo?.lng ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [depots.clientId, depots.depotRef],
          set: {
            name: input.name,
            lat: input.geo?.lat ?? null,
            lng: input.geo?.lng ?? null,
            updatedAt: now,
          },
        })
        .returning();
      if (!row) throw new Error(`Depot upsert returned no row for ${input.depotRef}`);

      // Replace the link set wholesale — the write IS the desired state.
      await current()
        .delete(depotStores)
        .where(and(eq(depotStores.clientId, clientId), eq(depotStores.depotRef, input.depotRef)));
      const unique = [...new Set(input.storeRefs)];
      if (unique.length > 0) {
        await current()
          .insert(depotStores)
          .values(unique.map((storeRef) => ({ clientId, depotRef: input.depotRef, storeRef })));
      }
      return {
        id: row.id,
        depotRef: row.depotRef,
        name: row.name,
        geo: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
        storeRefs: unique.toSorted(),
      };
    },

    async listByClient(clientId): Promise<readonly DepotSummary[]> {
      const rows = await current()
        .select()
        .from(depots)
        .where(eq(depots.clientId, clientId))
        .orderBy(asc(depots.depotRef));
      const links = await linksFor(
        clientId,
        rows.map((r) => r.depotRef),
      );
      return rows.map((row) => ({
        id: row.id,
        depotRef: row.depotRef,
        name: row.name,
        geo: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
        storeRefs: links.get(row.depotRef) ?? [],
      }));
    },

    async findByRef(clientId, depotRef): Promise<DepotSummary | null> {
      const [row] = await current()
        .select()
        .from(depots)
        .where(and(eq(depots.clientId, clientId), eq(depots.depotRef, depotRef)))
        .limit(1);
      if (!row) return null;
      const links = await linksFor(clientId, [depotRef]);
      return {
        id: row.id,
        depotRef: row.depotRef,
        name: row.name,
        geo: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
        storeRefs: links.get(depotRef) ?? [],
      };
    },

    async storesForDepot(clientId, depotRef): Promise<readonly string[]> {
      const rows = await current()
        .select({ storeRef: depotStores.storeRef })
        .from(depotStores)
        .where(and(eq(depotStores.clientId, clientId), eq(depotStores.depotRef, depotRef)))
        .orderBy(asc(depotStores.storeRef));
      return rows.map((r) => r.storeRef);
    },

    async delete(clientId, depotRef): Promise<boolean> {
      await current()
        .delete(depotStores)
        .where(and(eq(depotStores.clientId, clientId), eq(depotStores.depotRef, depotRef)));
      const rows = await current()
        .delete(depots)
        .where(and(eq(depots.clientId, clientId), eq(depots.depotRef, depotRef)))
        .returning({ id: depots.id });
      return rows.length > 0;
    },
  };
}
