import type { PickerUserId } from './ids.js';

export const PICKER_USER_TYPE = 'PickerUser' as const;

/** How the picker signs in on the station (see docs/pick-context-auth.md). */
export type PrimaryAuthMethod = 'pin' | 'qr';
export type PickerStatus = 'active' | 'suspended';

/**
 * A picker — a person who signs in on a store-bound station. Local to the pick
 * context (never a platform principal). This slice implements PIN-primary only:
 * a `pinHash` is set at creation; QR badges, devices, and the break-glass PIN
 * flow land in later phases.
 *
 * Login lockout bookkeeping (`failedPinAttempts`/`lockedUntil`) is high-
 * frequency auth state, NOT a domain event — it persists via a direct
 * repository write, so those transitions don't bump `version`. Provisioning
 * (`create`) does go through the aggregate/outbox path.
 */
export interface PickerUser {
  readonly id: PickerUserId;
  readonly clientId: string;
  readonly storeRef: string;
  readonly displayName: string;
  /** Unique per (clientId, storeRef) — the identifier a picker types before their PIN. */
  readonly staffCode: string;
  readonly primaryAuthMethod: PrimaryAuthMethod;
  readonly status: PickerStatus;
  /** scrypt hash of the PIN (pin-primary). Null once QR-primary is supported. */
  readonly pinHash: string | null;
  readonly failedPinAttempts: number;
  readonly lockedUntil: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePickerUserInput {
  readonly id: PickerUserId;
  readonly clientId: string;
  readonly storeRef: string;
  readonly displayName: string;
  readonly staffCode: string;
  readonly primaryAuthMethod: PrimaryAuthMethod;
  readonly pinHash: string | null;
  readonly now: Date;
}

export const PickerUser = {
  create(input: CreatePickerUserInput): PickerUser {
    return {
      id: input.id,
      clientId: input.clientId,
      storeRef: input.storeRef,
      displayName: input.displayName,
      staffCode: input.staffCode,
      primaryAuthMethod: input.primaryAuthMethod,
      status: 'active',
      pinHash: input.pinHash,
      failedPinAttempts: 0,
      lockedUntil: null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /** True while a lockout window is still in effect. */
  isLocked(picker: PickerUser, now: Date): boolean {
    return picker.lockedUntil !== null && picker.lockedUntil.getTime() > now.getTime();
  },

  /**
   * Record a failed PIN attempt. On reaching `maxAttempts`, lock for `lockMs`
   * and reset the counter (so the next window starts clean).
   */
  registerFailedPin(
    prior: PickerUser,
    now: Date,
    maxAttempts: number,
    lockMs: number,
  ): PickerUser {
    const failed = prior.failedPinAttempts + 1;
    const locked = failed >= maxAttempts;
    return {
      ...prior,
      failedPinAttempts: locked ? 0 : failed,
      lockedUntil: locked ? new Date(now.getTime() + lockMs) : prior.lockedUntil,
      updatedAt: now,
    };
  },

  /** Clear failure counter + any lockout after a successful login. */
  clearLockout(prior: PickerUser, now: Date): PickerUser {
    return { ...prior, failedPinAttempts: 0, lockedUntil: null, updatedAt: now };
  },
} as const;
