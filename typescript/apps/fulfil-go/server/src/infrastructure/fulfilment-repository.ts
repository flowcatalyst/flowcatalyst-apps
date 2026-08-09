import { and, asc, desc, eq, gte, ilike, inArray, lte, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  TransactionStore,
  resolveDb,
  type TransactionContext,
} from '@flowcatalyst-apps/app-framework';
import { ConcurrencyConflictError } from '@fulfil-go/framework';
import type {
  AdditionalData,
  Destination,
  FulfilmentLine,
  FulfilmentPolicies,
  FulfilmentStatus,
  FulfilmentType,
  OriginLocation,
  PartStatus,
  Provenance,
  ServiceLevel,
} from '@fulfil-go/shared';
import {
  asFulfilmentId,
  asFulfilmentPartId,
  type FulfilmentId,
} from '../domain/fulfilments/ids.js';
import type { Fulfilment, FulfilmentPart } from '../domain/fulfilments/fulfilment.js';
import type {
  DuePartRef,
  FulfilmentRepository,
} from '../domain/fulfilments/fulfilment.repository.js';
import { fulfilments, type FulfilmentRow } from './schema/fulfilments.js';
import { fulfilmentParts, type FulfilmentPartRow } from './schema/fulfilment-parts.js';

function partToDomain(row: FulfilmentPartRow): FulfilmentPart {
  return {
    id: asFulfilmentPartId(row.id),
    shortId: row.shortId,
    status: row.status as PartStatus,
    releaseAt: row.releaseAt,
    origin: row.origin as OriginLocation,
    lines: row.lines as FulfilmentLine[],
    pickupPin: row.pickupPin,
    lineResults: (row.lineResults as FulfilmentPart['lineResults']) ?? null,
    packages: (row.packages as FulfilmentPart['packages']) ?? null,
    requiresCarOrLarger: row.requiresCarOrLarger,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDomain(row: FulfilmentRow, partRows: readonly FulfilmentPartRow[]): Fulfilment {
  return {
    id: asFulfilmentId(row.id),
    clientId: row.clientId,
    externalSource: row.externalSource,
    externalRef: row.externalRef,
    type: row.type as FulfilmentType,
    serviceLevel: row.serviceLevel as ServiceLevel,
    status: row.status as FulfilmentStatus,
    processDefinition: row.processDefinition,
    slotStart: row.slotStart,
    slotEnd: row.slotEnd,
    timezone: row.timezone,
    destination: row.destination as Destination,
    policies: row.policies as FulfilmentPolicies,
    handoverPolicy: (row.handoverPolicy as Fulfilment['handoverPolicy']) ?? null,
    deliveryPin: row.deliveryPin,
    maxRestrictedAge: row.maxRestrictedAge,
    provenance: (row.provenance as Provenance | null) ?? null,
    additionalData: (row.additionalData as AdditionalData | null) ?? null,
    parts: partRows.map(partToDomain),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleFulfilmentRepository(db: PostgresJsDatabase): FulfilmentRepository {
  // Reads join the ambient use-case tx (ALS) — see pick-repository for why
  // (in-tx visibility + pool self-deadlock under concurrent write bursts).
  const current = () => resolveDb(db, TransactionStore.get());

  async function loadParts(fulfilmentId: string): Promise<FulfilmentPartRow[]> {
    return current()
      .select()
      .from(fulfilmentParts)
      .where(eq(fulfilmentParts.fulfilmentId, fulfilmentId))
      .orderBy(asc(fulfilmentParts.shortId));
  }

  return {
    async persist(aggregate: Fulfilment, tx?: TransactionContext): Promise<Fulfilment> {
      const client = resolveDb(db, tx);
      let row: FulfilmentRow | undefined;
      if (aggregate.version === 1) {
        [row] = await client
          .insert(fulfilments)
          .values({
            id: aggregate.id,
            clientId: aggregate.clientId,
            externalSource: aggregate.externalSource,
            externalRef: aggregate.externalRef,
            type: aggregate.type,
            serviceLevel: aggregate.serviceLevel,
            status: aggregate.status,
            processDefinition: aggregate.processDefinition,
            slotStart: aggregate.slotStart,
            slotEnd: aggregate.slotEnd,
            timezone: aggregate.timezone,
            destination: aggregate.destination,
            policies: aggregate.policies,
            handoverPolicy: aggregate.handoverPolicy,
            deliveryPin: aggregate.deliveryPin,
            maxRestrictedAge: aggregate.maxRestrictedAge,
            provenance: aggregate.provenance,
            additionalData: aggregate.additionalData,
            version: aggregate.version,
            createdAt: aggregate.createdAt,
            updatedAt: aggregate.updatedAt,
          })
          .returning();
      } else {
        // Optimistic locking (house rule: every domain operation). The
        // aggregate carries the post-transition version; the UPDATE guards
        // on the prior one. No match = someone else won — 409 via the
        // server error handler, tx rolls back. Immutable captured data
        // never changes; only process state does.
        [row] = await client
          .update(fulfilments)
          .set({
            status: aggregate.status,
            version: aggregate.version,
            updatedAt: aggregate.updatedAt,
          })
          .where(
            and(eq(fulfilments.id, aggregate.id), eq(fulfilments.version, aggregate.version - 1)),
          )
          .returning();
        if (!row) {
          throw new ConcurrencyConflictError('Fulfilment', aggregate.id, aggregate.version - 1);
        }
      }
      if (!row) throw new Error(`Fulfilment persist returned no row for id=${aggregate.id}`);

      const partRows: FulfilmentPartRow[] = [];
      for (const part of aggregate.parts) {
        const [partRow] = await client
          .insert(fulfilmentParts)
          .values({
            id: part.id,
            fulfilmentId: aggregate.id,
            clientId: aggregate.clientId,
            shortId: part.shortId,
            originRef: part.origin.ref,
            origin: part.origin,
            lines: part.lines,
            status: part.status,
            releaseAt: part.releaseAt,
            pickupPin: part.pickupPin,
            lineResults: part.lineResults,
            packages: part.packages,
            requiresCarOrLarger: part.requiresCarOrLarger,
            createdAt: part.createdAt,
            updatedAt: part.updatedAt,
          })
          .onConflictDoUpdate({
            target: fulfilmentParts.id,
            set: {
              status: part.status,
              lineResults: part.lineResults,
              packages: part.packages,
              requiresCarOrLarger: part.requiresCarOrLarger,
              updatedAt: part.updatedAt,
            },
          })
          .returning();
        if (!partRow) throw new Error(`Part persist returned no row for id=${part.id}`);
        partRows.push(partRow);
      }

      return toDomain(row, partRows);
    },

    async delete(aggregate: Fulfilment, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      await client.delete(fulfilmentParts).where(eq(fulfilmentParts.fulfilmentId, aggregate.id));
      const rows = await client
        .delete(fulfilments)
        .where(eq(fulfilments.id, aggregate.id))
        .returning();
      return rows.length > 0;
    },

    async getProcessDefinition(clientId: string, id: FulfilmentId): Promise<string | null> {
      const [row] = await current()
        .select({ processDefinition: fulfilments.processDefinition })
        .from(fulfilments)
        .where(and(eq(fulfilments.id, id), eq(fulfilments.clientId, clientId)))
        .limit(1);
      return row?.processDefinition ?? null;
    },

    async findById(clientId: string, id: FulfilmentId): Promise<Fulfilment | null> {
      const [row] = await current()
        .select()
        .from(fulfilments)
        .where(and(eq(fulfilments.id, id), eq(fulfilments.clientId, clientId)))
        .limit(1);
      if (!row) return null;
      return toDomain(row, await loadParts(row.id));
    },

    async listDueParts(now: Date, limit: number): Promise<readonly DuePartRef[]> {
      const rows = await current()
        .select({
          clientId: fulfilmentParts.clientId,
          fulfilmentId: fulfilmentParts.fulfilmentId,
          partId: fulfilmentParts.id,
        })
        .from(fulfilmentParts)
        .innerJoin(fulfilments, eq(fulfilments.id, fulfilmentParts.fulfilmentId))
        .where(
          and(
            eq(fulfilmentParts.status, 'pending'),
            lte(fulfilmentParts.releaseAt, now),
            inArray(fulfilments.status, ['created', 'in_progress']),
          ),
        )
        .orderBy(asc(fulfilmentParts.releaseAt))
        .limit(limit);
      return rows.map((r) => ({
        clientId: r.clientId,
        fulfilmentId: asFulfilmentId(r.fulfilmentId),
        partId: asFulfilmentPartId(r.partId),
      }));
    },

    async listByClient(
      clientId: string,
      limit: number,
      offset: number,
      storeRefs?: readonly string[],
      filters?: {
        readonly statuses?: readonly string[];
        readonly type?: string;
        readonly slotFrom?: Date;
        readonly slotTo?: Date;
        readonly q?: string;
        readonly sortField?: 'createdAt' | 'slotStart' | 'status';
        readonly sortDir?: 'asc' | 'desc';
      },
    ) {
      const conditions = [eq(fulfilments.clientId, clientId)];
      if (filters?.q) {
        // externalRef contains OR any part shortId starts-with — the two refs
        // an operator actually has in hand.
        const needle = filters.q.trim();
        const condition = or(
          ilike(fulfilments.externalRef, `%${needle}%`),
          inArray(
            fulfilments.id,
            db
              .select({ id: fulfilmentParts.fulfilmentId })
              .from(fulfilmentParts)
              .where(
                and(
                  eq(fulfilmentParts.clientId, clientId),
                  ilike(fulfilmentParts.shortId, `${needle}%`),
                ),
              ),
          ),
        );
        if (condition) conditions.push(condition);
      }
      if (filters?.statuses && filters.statuses.length > 0) {
        conditions.push(inArray(fulfilments.status, [...filters.statuses]));
      }
      if (filters?.type) conditions.push(eq(fulfilments.type, filters.type));
      // slotStart range rides idx_fulfilments_client_slot (2026-07 index pass).
      if (filters?.slotFrom) conditions.push(gte(fulfilments.slotStart, filters.slotFrom));
      if (filters?.slotTo) conditions.push(lte(fulfilments.slotStart, filters.slotTo));
      if (storeRefs && storeRefs.length > 0) {
        // "Any part at any of these stores" — semi-join on the indexed
        // origin_ref column rather than digging into the jsonb origin.
        conditions.push(
          inArray(
            fulfilments.id,
            db
              .select({ id: fulfilmentParts.fulfilmentId })
              .from(fulfilmentParts)
              .where(
                and(
                  eq(fulfilmentParts.clientId, clientId),
                  inArray(fulfilmentParts.originRef, [...storeRefs]),
                ),
              ),
          ),
        );
      }
      const sortColumn = {
        createdAt: fulfilments.createdAt,
        slotStart: fulfilments.slotStart,
        status: fulfilments.status,
      }[filters?.sortField ?? 'createdAt'];
      const dir = (filters?.sortDir ?? 'desc') === 'asc' ? asc : desc;
      const rows = await current()
        .select()
        .from(fulfilments)
        .where(and(...conditions))
        .orderBy(dir(sortColumn), desc(fulfilments.createdAt))
        .limit(limit)
        .offset(offset);
      if (rows.length === 0) return [];
      const partRows = await current()
        .select()
        .from(fulfilmentParts)
        .where(
          inArray(
            fulfilmentParts.fulfilmentId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(fulfilmentParts.shortId));
      const byFulfilment = new Map<string, FulfilmentPartRow[]>();
      for (const p of partRows) {
        const list = byFulfilment.get(p.fulfilmentId) ?? [];
        list.push(p);
        byFulfilment.set(p.fulfilmentId, list);
      }
      return rows.map((row) => toDomain(row, byFulfilment.get(row.id) ?? []));
    },

    async findByExternalRef(
      clientId: string,
      externalSource: string,
      externalRef: string,
    ): Promise<Fulfilment | null> {
      const [row] = await current()
        .select()
        .from(fulfilments)
        .where(
          and(
            eq(fulfilments.clientId, clientId),
            eq(fulfilments.externalSource, externalSource),
            eq(fulfilments.externalRef, externalRef),
          ),
        )
        .limit(1);
      if (!row) return null;
      return toDomain(row, await loadParts(row.id));
    },
  };
}
