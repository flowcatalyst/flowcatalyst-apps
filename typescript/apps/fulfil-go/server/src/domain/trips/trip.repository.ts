import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Trip } from './trip.js';
import type { TripId } from './ids.js';

export interface TripRepository {
  persist(aggregate: Trip, tx?: TransactionContext): Promise<Trip>;
  delete(aggregate: Trip, tx?: TransactionContext): Promise<boolean>;

  /** Tenant-scoped read — a trip is never visible across clients. */
  findById(clientId: string, id: TripId): Promise<Trip | null>;

  /** Management/debug view — newest first. */
  listByClient(
    clientId: string,
    limit: number,
    offset: number,
    statuses?: readonly string[],
  ): Promise<readonly Trip[]>;

  /** The driver app's "my trips" — this driver's trips, newest first. */
  listByDriver(
    clientId: string,
    driverRef: string,
    statuses: readonly string[],
    limit: number,
  ): Promise<readonly Trip[]>;
}
