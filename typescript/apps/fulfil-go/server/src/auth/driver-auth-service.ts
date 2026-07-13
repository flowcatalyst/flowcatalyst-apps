/**
 * Driver app login — the PICKER pattern (decided Andrew 2026-07-13): resolve
 * a driver from (depot, staffCode), verify the PIN, apply attempt lockout,
 * and mint a depot-scoped session token. Identity is code + PIN only in v1 —
 * device pinning waits for the shared device-enrollment phase (same parked
 * story as the picking plane; the token's deviceId claim is the seam).
 *
 * NOT a domain use case: it returns tokens, and its only persistence is
 * auth-lockout bookkeeping via `repo.updateLockout`.
 */
import { DRIVER_SESSION_PERMISSIONS } from '@fulfil-go/shared';
import type { PickerAuthConfig } from './auth-config.js';
import { verifySecret } from './pick-credentials.js';
import type { IssuedSession, PickerTokenService } from './picker-token.js';
import { DriverUser } from '../domain/driver-identity/driver-user.js';
import type { DriverUserRepository } from '../domain/driver-identity/driver-user.repository.js';

export interface DriverPinLoginInput {
  readonly clientId: string;
  /** Home depot — depots registry ref. */
  readonly depotRef: string;
  readonly staffCode: string;
  readonly pin: string;
}

export type DriverLoginOutcome =
  | { readonly ok: true; readonly session: IssuedSession }
  | {
      readonly ok: false;
      readonly status: 401 | 423;
      readonly code: string;
      readonly message: string;
    };

// Deliberately generic — no account enumeration.
const INVALID_CREDENTIALS: DriverLoginOutcome = {
  ok: false,
  status: 401,
  code: 'INVALID_CREDENTIALS',
  message: 'Invalid staff code or PIN.',
};

export interface DriverAuthService {
  loginWithPin(input: DriverPinLoginInput): Promise<DriverLoginOutcome>;
}

export function createDriverAuthService(
  repo: DriverUserRepository,
  tokens: PickerTokenService,
  config: PickerAuthConfig,
): DriverAuthService {
  return {
    async loginWithPin(input: DriverPinLoginInput): Promise<DriverLoginOutcome> {
      const now = new Date();
      const driver = await repo.findByStaffCode(input.clientId, input.depotRef, input.staffCode);
      if (!driver || driver.status !== 'active' || driver.pinHash === null) {
        return INVALID_CREDENTIALS;
      }
      if (DriverUser.isLocked(driver, now)) {
        return {
          ok: false,
          status: 423,
          code: 'DRIVER_LOCKED',
          message: 'Too many failed attempts. Try again later.',
        };
      }

      const pinOk = await verifySecret(input.pin, driver.pinHash);
      if (!pinOk) {
        const updated = DriverUser.registerFailedPin(
          driver,
          now,
          config.pinMaxAttempts,
          config.lockoutMs,
        );
        await repo.updateLockout(updated);
        return INVALID_CREDENTIALS;
      }

      // Success — clear any accumulated failure state.
      if (driver.failedPinAttempts > 0 || driver.lockedUntil !== null) {
        await repo.updateLockout(DriverUser.clearLockout(driver, now));
      }

      const session = await tokens.issueSession({
        pickerId: driver.id, // generic subject slot — the token service is shared
        clientId: driver.clientId,
        storeRef: driver.depotRef, // generic context slot — depot for drivers
        permissions: [...DRIVER_SESSION_PERMISSIONS],
      });
      return { ok: true, session };
    },
  };
}
