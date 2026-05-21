import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import {
  asLayerId,
  asPropertyId,
  asPropertySetId,
  type LayerId,
  type PropertySetId,
} from '../domain/layers/ids.js';
import type {
  Property,
  PropertySet,
} from '../domain/layers/property-set.js';
import type { PropertySetRepository } from '../domain/layers/property-set.repository.js';
import { properties, type PropertyRow } from './schema/properties.js';
import { propertySets, type PropertySetRow } from './schema/property-sets.js';

function toProperty(row: PropertyRow): Property {
  return {
    id: asPropertyId(row.id),
    propertySetId: asPropertySetId(row.propertySetId),
    key: row.key,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDomain(row: PropertySetRow, children: readonly Property[]): PropertySet {
  return {
    id: asPropertySetId(row.id),
    layerId: asLayerId(row.layerId),
    name: row.name,
    description: row.description,
    properties: children,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzlePropertySetRepository(
  db: PostgresJsDatabase,
): PropertySetRepository {
  async function loadPropertiesForSets(
    client: ReturnType<typeof resolveDb>,
    setIds: readonly string[],
  ): Promise<Map<string, Property[]>> {
    if (setIds.length === 0) return new Map();
    const rows = await client
      .select()
      .from(properties)
      .where(inArray(properties.propertySetId, [...setIds]))
      .orderBy(asc(properties.createdAt));
    const grouped = new Map<string, Property[]>();
    for (const row of rows) {
      const list = grouped.get(row.propertySetId) ?? [];
      list.push(toProperty(row));
      grouped.set(row.propertySetId, list);
    }
    return grouped;
  }

  return {
    async persist(aggregate: PropertySet, tx?: TransactionContext): Promise<PropertySet> {
      const client = resolveDb(db, tx);

      const [setRow] = await client
        .insert(propertySets)
        .values({
          id: aggregate.id,
          layerId: aggregate.layerId,
          name: aggregate.name,
          description: aggregate.description,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.updatedAt,
        })
        .onConflictDoUpdate({
          target: propertySets.id,
          set: {
            name: aggregate.name,
            description: aggregate.description,
            updatedAt: aggregate.updatedAt,
          },
        })
        .returning();
      if (!setRow) throw new Error(`PropertySet persist returned no row for id=${aggregate.id}`);

      // Sync child rows: delete-all + insert-all. Update-set keeps its
      // existing properties because the use case threads them through
      // PropertySet.update; create-set + replace-properties pass the
      // intended final list. This sacrifices stable property ids on
      // update-set, but properties carry no behaviour outside their set
      // so that's fine.
      await client.delete(properties).where(eq(properties.propertySetId, aggregate.id));
      if (aggregate.properties.length > 0) {
        await client.insert(properties).values(
          aggregate.properties.map((p) => ({
            id: p.id,
            propertySetId: p.propertySetId,
            key: p.key,
            value: p.value,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        );
      }

      return toDomain(setRow, aggregate.properties);
    },

    async delete(aggregate: PropertySet, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      // Child `properties` rows cascade on FK.
      const rows = await client
        .delete(propertySets)
        .where(eq(propertySets.id, aggregate.id))
        .returning();
      return rows.length > 0;
    },

    async findById(id: PropertySetId): Promise<PropertySet | null> {
      const client = resolveDb(db);
      const [row] = await client.select().from(propertySets).where(eq(propertySets.id, id)).limit(1);
      if (!row) return null;
      const childMap = await loadPropertiesForSets(client, [row.id]);
      return toDomain(row, childMap.get(row.id) ?? []);
    },

    async findByLayerAndName(layerId: LayerId, name: string): Promise<PropertySet | null> {
      const client = resolveDb(db);
      const [row] = await client
        .select()
        .from(propertySets)
        .where(and(eq(propertySets.layerId, layerId), eq(propertySets.name, name)))
        .limit(1);
      if (!row) return null;
      const childMap = await loadPropertiesForSets(client, [row.id]);
      return toDomain(row, childMap.get(row.id) ?? []);
    },

    async listByLayer(layerId: LayerId): Promise<readonly PropertySet[]> {
      const client = resolveDb(db);
      const rows = await client
        .select()
        .from(propertySets)
        .where(eq(propertySets.layerId, layerId))
        .orderBy(asc(propertySets.createdAt));
      if (rows.length === 0) return [];
      const childMap = await loadPropertiesForSets(
        client,
        rows.map((r) => r.id),
      );
      return rows.map((row) => toDomain(row, childMap.get(row.id) ?? []));
    },

    async countByLayerIds(
      layerIds: readonly LayerId[],
    ): Promise<ReadonlyMap<string, number>> {
      if (layerIds.length === 0) return new Map();
      const rows = await db
        .select({
          layerId: propertySets.layerId,
          value: count(),
        })
        .from(propertySets)
        .where(inArray(propertySets.layerId, [...layerIds] as string[]))
        .groupBy(propertySets.layerId);
      const out = new Map<string, number>();
      for (const r of rows) out.set(r.layerId, Number(r.value));
      return out;
    },
  };
}
