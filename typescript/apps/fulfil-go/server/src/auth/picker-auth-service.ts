/**
 * Picker station login — resolves a picker from (store, staffCode), verifies
 * the PIN, applies attempt lockout, and mints a store-scoped session token.
 *
 * NOT a domain use case: it returns tokens, not a sealed `Result<Event>`, and
 * its only persistence is auth-lockout bookkeeping via
 * `repo.updateLockout` (a direct write, no outbox event). See
 * docs/pick-context-auth.md.
 */
import { PICKER_SESSION_PERMISSIONS } from '@fulfil-go/shared';
import type { PickerAuthConfig } from './auth-config.js';
import { verifySecret } from './pick-credentials.js';
import type { IssuedSession, PickerTokenService } from './picker-token.js';
import { PickerUser } from '../domain/pick-identity/picker-user.js';
import type { PickerUserRepository } from '../domain/pick-identity/picker-user.repository.js';

export interface PinLoginInput {
  readonly clientId: string;
  readonly storeRef: string;
  readonly staffCode: string;
  readonly pin: string;
}

export type LoginOutcome =
  | { readonly ok: true; readonly session: IssuedSession }
  | {
      readonly ok: false;
      readonly status: 401 | 423;
      readonly code: string;
      readonly message: string;
    };

// Deliberately generic so a caller can't distinguish "no such staff code" from
// "wrong PIN" (no account enumeration).
const INVALID_CREDENTIALS: LoginOutcome = {
  ok: false,
  status: 401,
  code: 'INVALID_CREDENTIALS',
  message: 'Invalid staff code or PIN.',
};

export interface PickerAuthService {
  loginWithPin(input: PinLoginInput): Promise<LoginOutcome>;
}

export function createPickerAuthService(
  repo: PickerUserRepository,
  tokens: PickerTokenService,
  config: PickerAuthConfig,
): PickerAuthService {
  return {
    async loginWithPin(input: PinLoginInput): Promise<LoginOutcome> {
      const now = new Date();
      const picker = await repo.findByStaffCode(input.clientId, input.storeRef, input.staffCode);
      if (!picker || picker.status !== 'active' || picker.pinHash === null) {
        return INVALID_CREDENTIALS;
      }
      if (PickerUser.isLocked(picker, now)) {
        return {
          ok: false,
          status: 423,
          code: 'PICKER_LOCKED',
          message: 'Too many failed attempts. Try again later.',
        };
      }

      const pinOk = await verifySecret(input.pin, picker.pinHash);
      if (!pinOk) {
        const updated = PickerUser.registerFailedPin(
          picker,
          now,
          config.pinMaxAttempts,
          config.lockoutMs,
        );
        await repo.updateLockout(updated);
        return INVALID_CREDENTIALS;
      }

      // Success — clear any accumulated failure state.
      if (picker.failedPinAttempts > 0 || picker.lockedUntil !== null) {
        await repo.updateLockout(PickerUser.clearLockout(picker, now));
      }

      const session = await tokens.issueSession({
        pickerId: picker.id,
        clientId: picker.clientId,
        storeRef: picker.storeRef,
        permissions: [...PICKER_SESSION_PERMISSIONS],
      });
      return { ok: true, session };
    },
  };
}
