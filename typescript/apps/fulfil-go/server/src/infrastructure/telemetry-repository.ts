import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { telemetryLocations, type NewTelemetryLocation } from './schema/telemetry-locations.js';

export interface TelemetryRepository {
  /**
   * Plain batch insert — deliberately no runWrite/outbox/aggregate ceremony.
   * The Transistorsoft uploader retries on non-2xx, so a failed insert throws
   * (→ 500 → native retry) rather than partially applying.
   */
  insertBatch(rows: readonly NewTelemetryLocation[]): Promise<number>;
}

export function createDrizzleTelemetryRepository(db: PostgresJsDatabase): TelemetryRepository {
  return {
    async insertBatch(rows): Promise<number> {
      if (rows.length === 0) return 0;
      const inserted = await db
        .insert(telemetryLocations)
        .values([...rows])
        .returning({ id: telemetryLocations.id });
      return inserted.length;
    },
  };
}
