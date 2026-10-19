import type { FastifyReply } from 'fastify';
import { ScopeStore, UseCaseError } from '@pinpoint/framework';
import type { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import {
  canAccessClient,
  canAccessPartition,
  resolvePartitionAccess,
  type PartitionAccess,
} from '../../../domain/auth/partition-access.js';
import type {
  RequestLogEntry,
  RequestLogVisibility,
} from '../../../domain/reporting/request-log.repository.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

function deny(reply: FastifyReply, code: string, message: string): null {
  void sendUseCaseError(reply, UseCaseError.authorization(code, message));
  return null;
}

/**
 * Gate for the reporting routes: authenticated, holds `permission`, and may
 * see any client / partition the request names. Returns the caller's access
 * (to scope the query with `visibilityOf`), or null once a 401 / 403 is sent.
 */
export async function authorizeReporting(
  reply: FastifyReply,
  appContext: AppContext,
  permission: PinpointPermission,
  requested: {
    readonly clientId?: string | undefined;
    readonly partitionId?: string | undefined;
  } = {},
): Promise<PartitionAccess | null> {
  const scope = ScopeStore.get();
  if (!scope) {
    void reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    return null;
  }
  if (!scope.permissions.has(permission)) {
    return deny(reply, 'PERMISSION_DENIED', `Missing permission ${permission}.`);
  }
  const access = await resolvePartitionAccess(scope, appContext.repositories.principals);
  if (requested.clientId && !canAccessClient(access, requested.clientId)) {
    return deny(reply, 'CLIENT_ACCESS_DENIED', `No access to client '${requested.clientId}'.`);
  }
  if (requested.partitionId && !canAccessPartition(access, requested.partitionId)) {
    return deny(
      reply,
      'PARTITION_ACCESS_DENIED',
      `No access to partition '${requested.partitionId}'.`,
    );
  }
  return access;
}

/** The query restriction for `access` — undefined when it sees everything. */
export function visibilityOf(access: PartitionAccess): RequestLogVisibility | undefined {
  if (access.all) return undefined;
  return {
    principalId: access.principalId,
    partitionIds: access.partitionIds,
    clientIds: access.clientIds,
  };
}

/** Whether one logged request is visible under `access` (same rule as the query). */
export function isVisible(
  access: PartitionAccess,
  entry: Pick<RequestLogEntry, 'clientId' | 'partitionId' | 'principalId'>,
): boolean {
  if (access.all || entry.principalId === access.principalId) return true;
  if (entry.partitionId !== null) return access.partitionIds.includes(entry.partitionId);
  return entry.clientId !== null && access.clientIds.includes(entry.clientId);
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

/**
 * Where a reporting route is mounted: the canonical API, or the SPA's BFF
 * (`/bff/...`, operationIds prefixed `bff`). Same handlers on both.
 */
export interface ReportingSurface {
  readonly basePath: '' | '/bff';
  operationId(name: string): string;
}

export const CANONICAL_SURFACE: ReportingSurface = {
  basePath: '',
  operationId: (name) => name,
};

export const BFF_SURFACE: ReportingSurface = {
  basePath: '/bff',
  operationId: (name) => `bff${name.charAt(0).toUpperCase()}${name.slice(1)}`,
};
