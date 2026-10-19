import type { FastifyReply } from 'fastify';
import { ScopeStore, UseCaseError } from '@pinpoint/framework';
import type { PinpointPermission } from '@pinpoint/shared';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

/**
 * Permission gate for the reporting routes. Returns true when the request may
 * proceed; otherwise it has already sent the 401 / 403.
 */
export function authorizeReporting(reply: FastifyReply, permission: PinpointPermission): boolean {
  const scope = ScopeStore.get();
  if (!scope) {
    void reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    return false;
  }
  if (!scope.permissions.has(permission)) {
    void sendUseCaseError(
      reply,
      UseCaseError.authorization('PERMISSION_DENIED', `Missing permission ${permission}.`),
    );
    return false;
  }
  return true;
}

/** True when `timezone` is an IANA zone name the runtime knows. */
export function isValidTimezone(timezone: string): boolean {
  try {
    // Throws a RangeError for a zone the runtime doesn't know.
    return new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}
