import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import { asLocationAttributeId, asLocationId, type LocationId } from '../domain/locations/ids.js';
import type { AttributeValue, LocationAttribute } from '../domain/locations/location-attribute.js';
import type { LocationAttributeRepository } from '../domain/locations/location-attribute.repository.js';
import { locationAttributes, type LocationAttributeRow } from './schema/location-attributes.js';

function valueFromJson(raw: unknown): AttributeValue {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'string' ? v : String(v)));
  // Defensive: the column is JSONB so anything else is a data-shape
  // issue — coerce to a string fallback rather than throwing.
  return String(raw);
}

function toDomain(row: LocationAttributeRow): LocationAttribute {
  return {
    id: asLocationAttributeId(row.id),
    locationId: asLocationId(row.locationId),
    key: row.key,
    value: valueFromJson(row.value),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleLocationAttributeRepository(
  db: PostgresJsDatabase,
): LocationAttributeRepository {
  return {
    async insertMany(
      attributes: readonly LocationAttribute[],
      tx?: TransactionContext,
    ): Promise<void> {
      if (attributes.length === 0) return;
      const client = resolveDb(db, tx);
      await client.insert(locationAttributes).values(
        attributes.map((a) => ({
          id: a.id,
          locationId: a.locationId,
          key: a.key,
          value: a.value,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
      );
    },

    async listByLocation(locationId: LocationId): Promise<readonly LocationAttribute[]> {
      const rows = await db
        .select()
        .from(locationAttributes)
        .where(eq(locationAttributes.locationId, locationId))
        .orderBy(asc(locationAttributes.createdAt));
      return rows.map(toDomain);
    },
  };
}
