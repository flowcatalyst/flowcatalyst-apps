import { desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { brandedTsid } from '@fulfil-go/framework';
import { transportPositions, type TransportPositionRow } from './schema/transport-positions.js';

export interface TransportPositionUpsert {
  readonly clientId: string | null;
  readonly executionSystem: string;
  readonly vehicleRef: string;
  readonly label?: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly heading?: number | null;
  readonly speed?: number | null;
  readonly recordedAt: Date;
  readonly tripRef?: string | null;
  readonly meta?: unknown;
}

export interface TransportPositionRepository {
  /**
   * Latest-wins upsert keyed (executionSystem, vehicleRef) — a stale fix
   * (recordedAt older than the stored row) never regresses the marker.
   * Plain pool write, telemetry-style: no tx/outbox ceremony.
   */
  upsertLatest(position: TransportPositionUpsert): Promise<void>;
  /** All vehicles visible to a client (clientless rows included — dev). */
  listForClient(clientId: string): Promise<readonly TransportPositionRow[]>;
}

export function createDrizzleTransportPositionRepository(
  db: PostgresJsDatabase,
): TransportPositionRepository {
  return {
    async upsertLatest(position): Promise<void> {
      await db
        .insert(transportPositions)
        .values({
          id: brandedTsid('pos'),
          clientId: position.clientId,
          executionSystem: position.executionSystem,
          vehicleRef: position.vehicleRef,
          label: position.label ?? null,
          lat: position.lat,
          lng: position.lng,
          heading: position.heading ?? null,
          speed: position.speed ?? null,
          recordedAt: position.recordedAt,
          tripRef: position.tripRef ?? null,
          meta: position.meta ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [transportPositions.executionSystem, transportPositions.vehicleRef],
          set: {
            clientId: sql`excluded.client_id`,
            label: sql`excluded.label`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            heading: sql`excluded.heading`,
            speed: sql`excluded.speed`,
            recordedAt: sql`excluded.recorded_at`,
            tripRef: sql`excluded.trip_ref`,
            meta: sql`excluded.meta`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: sql`excluded.recorded_at >= ${transportPositions.recordedAt}`,
        });
    },

    async listForClient(clientId): Promise<readonly TransportPositionRow[]> {
      return db
        .select()
        .from(transportPositions)
        .where(or(eq(transportPositions.clientId, clientId), isNull(transportPositions.clientId)))
        .orderBy(desc(transportPositions.recordedAt));
    },
  };
}
