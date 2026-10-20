/**
 * Which clients and partitions a principal may see. Same model as the Rust
 * pinpoint (`authorization.rs`): anchors / super-admins / pinpoint admins see
 * everything; everyone else sees exactly the partitions granted to them in
 * `principal_partitions` (grant / revoke-partition-access use cases), and the
 * clients those partitions belong to.
 *
 * "Sees everything" is decided at authentication time from the token
 * (`isAnchor`) and carried on the request Scope as an attribute, so this
 * module needs no claims — only the scope and the grants.
 */
import type { Scope } from '@pinpoint/framework';
import type { PrincipalId } from './ids.js';
import type { PrincipalRepository } from './principal.repository.js';

/** Scope attribute set to 'true' for principals that may see every client. */
export const ALL_CLIENTS_ATTRIBUTE = 'pinpoint.allClients';

export type PartitionAccess =
  | { readonly all: true }
  | {
      readonly all: false;
      readonly principalId: string;
      readonly partitionIds: readonly string[];
      readonly clientIds: readonly string[];
    };

export async function resolvePartitionAccess(
  scope: Scope,
  principals: PrincipalRepository,
): Promise<PartitionAccess> {
  if (scope.attributes[ALL_CLIENTS_ATTRIBUTE] === 'true') return { all: true };
  const grants = await principals.listPartitionGrants(scope.principalId as PrincipalId);
  return {
    all: false,
    principalId: scope.principalId,
    partitionIds: grants.map((g) => g.partitionId),
    clientIds: [...new Set(grants.map((g) => g.clientId))],
  };
}

export function canAccessClient(access: PartitionAccess, clientId: string): boolean {
  return access.all || access.clientIds.includes(clientId);
}

export function canAccessPartition(access: PartitionAccess, partitionId: string): boolean {
  return access.all || access.partitionIds.includes(partitionId);
}
