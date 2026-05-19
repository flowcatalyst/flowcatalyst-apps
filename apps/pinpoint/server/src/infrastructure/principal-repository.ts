import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Principal, PrincipalDraft, PrincipalType } from '../domain/auth/principal.js';
import type { PrincipalRepository } from '../domain/auth/principal.repository.js';
import { asPrincipalId, type PrincipalId } from '../domain/auth/ids.js';
import { principals, type PrincipalRow } from './schema/principals.js';

function toDomain(row: PrincipalRow): Principal {
  return {
    id: asPrincipalId(row.id),
    principalType: row.principalType as PrincipalType,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzlePrincipalRepository(db: PostgresJsDatabase): PrincipalRepository {
  return {
    async findById(id: PrincipalId): Promise<Principal | null> {
      const [row] = await db.select().from(principals).where(eq(principals.id, id)).limit(1);
      return row ? toDomain(row) : null;
    },

    async upsert(draft: PrincipalDraft): Promise<Principal> {
      const now = new Date();
      const [row] = await db
        .insert(principals)
        .values({
          id: draft.id,
          principalType: draft.principalType,
          name: draft.name,
          email: draft.email ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: principals.id,
          set: {
            principalType: draft.principalType,
            name: draft.name,
            email: draft.email ?? null,
            updatedAt: now,
          },
        })
        .returning();

      if (!row) {
        throw new Error(`Principal upsert returned no row for id=${draft.id}`);
      }
      return toDomain(row);
    },
  };
}
