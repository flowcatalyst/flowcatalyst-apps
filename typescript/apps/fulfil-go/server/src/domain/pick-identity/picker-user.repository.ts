import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { PickerUser } from './picker-user.js';
import type { PickerUserId } from './ids.js';

export interface PickerUserRepository {
  /** Aggregate persist (create + optimistic-locked updates). Used by commitAggregate. */
  persist(aggregate: PickerUser, tx?: TransactionContext): Promise<PickerUser>;
  delete(aggregate: PickerUser, tx?: TransactionContext): Promise<boolean>;

  findById(clientId: string, id: PickerUserId): Promise<PickerUser | null>;

  /** The login lookup — staff code is unique within a store. */
  findByStaffCode(
    clientId: string,
    storeRef: string,
    staffCode: string,
  ): Promise<PickerUser | null>;

  /** Admin listing; optionally narrowed to one store. Ordered by store, staffCode. */
  listByClient(clientId: string, storeRef?: string): Promise<readonly PickerUser[]>;

  /** Batch lookup for display-name enrichment (admin pick views). */
  findByIds(clientId: string, ids: readonly string[]): Promise<readonly PickerUser[]>;

  /**
   * Dev/test seeding: plain batch insert, skipping rows whose staff code
   * already exists (idempotent re-runs). Deliberately NOT the aggregate path —
   * no outbox events, no per-row audit; use CreatePickerUseCase for real
   * provisioning. Returns the number actually inserted.
   */
  insertManyIfAbsent(pickers: readonly PickerUser[]): Promise<number>;

  /**
   * Dev/test: overwrite the PIN hash of SEEDED pickers (staff codes matching
   * the seeder's P<nn> pattern) — lets the shared dev PIN rotate without
   * touching manually-created pickers. Returns rows updated.
   */
  resetSeededPins(clientId: string, pinHash: string): Promise<number>;

  /**
   * Direct write of login-lockout bookkeeping (failedPinAttempts + lockedUntil
   * + updatedAt) by id — NO version guard, NO domain event. Auth state, not a
   * domain transition.
   */
  updateLockout(picker: PickerUser, tx?: TransactionContext): Promise<void>;
}
