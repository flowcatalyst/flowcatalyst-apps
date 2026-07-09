import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TransactionStore, resolveDb } from '@flowcatalyst-apps/app-framework';
import { shortIdCounters } from './schema/short-id-counters.js';

/** First value per scope — keeps every short id at 4+ digits. */
const FIRST_SHORT_ID = 1000;

export interface ShortIdAllocator {
  /**
   * Allocate the next short id for (client, store, service-day). Runs INSIDE
   * the ambient use-case transaction (TransactionStore — required), so a
   * failed create rolls the counter back with everything else and numbers
   * stay gapless-ish. The row lock serialises concurrent creates per scope.
   */
  allocate(clientId: string, originRef: string, serviceDay: string): Promise<string>;
}

/** Slot-start date in the fulfilment's timezone, as YYYY-MM-DD. */
export function serviceDayOf(slotStart: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(slotStart);
}

export function createShortIdAllocator(db: PostgresJsDatabase): ShortIdAllocator {
  return {
    async allocate(clientId, originRef, serviceDay): Promise<string> {
      const tx = TransactionStore.require();
      const client = resolveDb(db, tx);
      const [row] = await client
        .insert(shortIdCounters)
        .values({ clientId, originRef, serviceDay, nextValue: FIRST_SHORT_ID })
        .onConflictDoUpdate({
          target: [shortIdCounters.clientId, shortIdCounters.originRef, shortIdCounters.serviceDay],
          set: { nextValue: sql`${shortIdCounters.nextValue} + 1` },
        })
        .returning({ value: shortIdCounters.nextValue });
      if (!row) throw new Error('short-id allocation returned no row');
      return String(row.value);
    },
  };
}
