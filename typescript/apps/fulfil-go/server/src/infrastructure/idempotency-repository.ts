import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { idempotencyKeys, type IdempotencyKeyRow } from './schema/idempotency-keys.js';

export interface IdempotencyRepository {
  findByKey(key: string): Promise<IdempotencyKeyRow | null>;
  /**
   * Insert a stored response; returns false when the key already exists
   * (a concurrent duplicate won the race — caller replays the winner).
   */
  tryInsert(entry: {
    key: string;
    principalId: string;
    endpoint: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<boolean>;
}

export function createDrizzleIdempotencyRepository(db: PostgresJsDatabase): IdempotencyRepository {
  return {
    async findByKey(key): Promise<IdempotencyKeyRow | null> {
      const [row] = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, key))
        .limit(1);
      return row ?? null;
    },

    async tryInsert(entry): Promise<boolean> {
      const inserted = await db
        .insert(idempotencyKeys)
        .values(entry)
        .onConflictDoNothing({ target: idempotencyKeys.key })
        .returning({ key: idempotencyKeys.key });
      return inserted.length > 0;
    },
  };
}
