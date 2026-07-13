import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import type { ClientSettings } from '@fulfil-go/shared';
import { clientSettings } from './schema/client-settings.js';

export interface ClientSettingsRepository {
  /** The client's sparse settings row — null when never saved. */
  get(clientId: string): Promise<ClientSettings | null>;
  upsert(clientId: string, settings: ClientSettings): Promise<ClientSettings>;
}

export function createDrizzleClientSettingsRepository(
  db: PostgresJsDatabase,
): ClientSettingsRepository {
  // Reads join the ambient tx (ALS) — consulted inside create-fulfilment's
  // write tx (pool self-deadlock rule; see fulfilment-repository).
  const current = () => resolveDb(db, TransactionStore.get());

  return {
    async get(clientId): Promise<ClientSettings | null> {
      const [row] = await current()
        .select()
        .from(clientSettings)
        .where(eq(clientSettings.clientId, clientId))
        .limit(1);
      return row ? (row.settings as ClientSettings) : null;
    },

    async upsert(clientId, settings): Promise<ClientSettings> {
      const [row] = await current()
        .insert(clientSettings)
        .values({ clientId, settings, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: clientSettings.clientId,
          set: { settings, updatedAt: new Date() },
        })
        .returning();
      return row?.settings as ClientSettings;
    },
  };
}
