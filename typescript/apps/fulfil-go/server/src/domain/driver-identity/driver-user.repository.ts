import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { DriverUser } from './driver-user.js';
import type { DriverUserId } from './ids.js';

export interface DriverUserRepository {
  /** Aggregate persist (create + optimistic-locked updates). Used by commitAggregate. */
  persist(aggregate: DriverUser, tx?: TransactionContext): Promise<DriverUser>;
  delete(aggregate: DriverUser, tx?: TransactionContext): Promise<boolean>;

  findById(clientId: string, id: DriverUserId): Promise<DriverUser | null>;

  /** The login lookup — staff code is unique within a depot. */
  findByStaffCode(
    clientId: string,
    storeRef: string,
    staffCode: string,
  ): Promise<DriverUser | null>;

  /** Admin listing; optionally narrowed to one depot. Ordered by depot, staffCode. */
  listByClient(clientId: string, storeRef?: string): Promise<readonly DriverUser[]>;

  /**
   * Dev/test seeding: plain batch insert, skipping rows whose staff code
   * already exists (idempotent re-runs). Deliberately NOT the aggregate path —
   * no outbox events; use CreateDriverUseCase for real provisioning.
   * Returns the number actually inserted.
   */
  insertManyIfAbsent(drivers: readonly DriverUser[]): Promise<number>;

  /**
   * Dev/test: overwrite the PIN hash of SEEDED drivers (staff codes matching
   * the seeder's D<nn> pattern). Returns rows updated.
   */
  resetSeededPins(clientId: string, pinHash: string): Promise<number>;

  /**
   * Direct write of login-lockout bookkeeping — NO version guard, NO domain
   * event. Auth state, not a domain transition.
   */
  updateLockout(driver: DriverUser, tx?: TransactionContext): Promise<void>;
}
