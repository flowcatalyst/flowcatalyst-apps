import type { DriverUserId } from './ids.js';

export const DRIVER_USER_TYPE = 'DriverUser' as const;

export type DriverStatus = 'active' | 'suspended';

/**
 * A driver — a person who signs in on the execution app with staff code +
 * PIN (the PICKER pattern; decided Andrew 2026-07-13: no platform OIDC, no
 * device pinning in v1 — device enrollment is the same parked phase-2 story
 * as the picking plane's). Local to the transport context, never a platform
 * principal.
 *
 * Depot linkage: `depotRef` is the driver's HOME DEPOT — an entry in the
 * DEPOTS registry, independent of stores (a depot serves many stores via
 * depot_stores; Andrew 2026-07-13: no 1:1 depot↔store). It is the
 * session's operating context: offers compose from the stores the depot
 * serves.
 *
 * Login lockout bookkeeping (`failedPinAttempts`/`lockedUntil`) is high-
 * frequency auth state, NOT a domain event — it persists via a direct
 * repository write, so those transitions don't bump `version`.
 */
export interface DriverUser {
  readonly id: DriverUserId;
  readonly clientId: string;
  /** Home depot — a depots registry ref. */
  readonly depotRef: string;
  readonly displayName: string;
  /** Unique per (clientId, depotRef) — typed before the PIN. */
  readonly staffCode: string;
  readonly status: DriverStatus;
  /**
   * Registration of the vehicle this driver usually takes — the offer
   * binding's default when the app doesn't send one.
   */
  readonly defaultVehicleReg: string | null;
  /**
   * Vehicle CLASS code (bike/car/van — client-settings registry): drives
   * the trip capacity check (unit sizes per parcel, max units/mass per
   * class). Null = uncapped by class.
   */
  readonly defaultVehicleClass: string | null;
  /** scrypt hash of the PIN. */
  readonly pinHash: string | null;
  readonly failedPinAttempts: number;
  readonly lockedUntil: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateDriverUserInput {
  readonly id: DriverUserId;
  readonly clientId: string;
  readonly depotRef: string;
  readonly displayName: string;
  readonly staffCode: string;
  readonly defaultVehicleReg: string | null;
  readonly defaultVehicleClass: string | null;
  readonly pinHash: string | null;
  readonly now: Date;
}

export const DriverUser = {
  create(input: CreateDriverUserInput): DriverUser {
    return {
      id: input.id,
      clientId: input.clientId,
      depotRef: input.depotRef,
      displayName: input.displayName,
      staffCode: input.staffCode,
      status: 'active',
      defaultVehicleReg: input.defaultVehicleReg,
      defaultVehicleClass: input.defaultVehicleClass,
      pinHash: input.pinHash,
      failedPinAttempts: 0,
      lockedUntil: null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /** True while a lockout window is still in effect. */
  isLocked(driver: DriverUser, now: Date): boolean {
    return driver.lockedUntil !== null && driver.lockedUntil.getTime() > now.getTime();
  },

  /**
   * Record a failed PIN attempt. On reaching `maxAttempts`, lock for `lockMs`
   * and reset the counter (so the next window starts clean).
   */
  registerFailedPin(prior: DriverUser, now: Date, maxAttempts: number, lockMs: number): DriverUser {
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
  clearLockout(prior: DriverUser, now: Date): DriverUser {
    return { ...prior, failedPinAttempts: 0, lockedUntil: null, updatedAt: now };
  },

  /**
   * Inactivate — login rejects suspended drivers and refresh re-checks
   * status, so a live session ends within one access TTL.
   */
  suspend(prior: DriverUser, now: Date): DriverUser {
    return { ...prior, status: 'suspended', version: prior.version + 1, updatedAt: now };
  },

  reactivate(prior: DriverUser, now: Date): DriverUser {
    return { ...prior, status: 'active', version: prior.version + 1, updatedAt: now };
  },

  /**
   * Move to another home depot. Refresh re-checks the binding, so a moved
   * driver's old-depot session ends within one access TTL. Also clears any
   * lockout — a fresh start at the new depot.
   */
  reassign(prior: DriverUser, depotRef: string, now: Date): DriverUser {
    return {
      ...prior,
      depotRef,
      failedPinAttempts: 0,
      lockedUntil: null,
      version: prior.version + 1,
      updatedAt: now,
    };
  },
} as const;
