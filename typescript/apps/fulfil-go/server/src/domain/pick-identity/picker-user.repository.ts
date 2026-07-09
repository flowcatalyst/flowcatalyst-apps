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

  /**
   * Direct write of login-lockout bookkeeping (failedPinAttempts + lockedUntil
   * + updatedAt) by id — NO version guard, NO domain event. Auth state, not a
   * domain transition.
   */
  updateLockout(picker: PickerUser, tx?: TransactionContext): Promise<void>;
}
