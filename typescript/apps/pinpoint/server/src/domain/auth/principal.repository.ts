import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Principal, PrincipalDraft } from './principal.js';
import type { PrincipalId } from './ids.js';
import type { PartitionId } from '../tenancy/ids.js';

export interface PrincipalWithGrant {
  readonly principal: Principal;
  readonly grantedAt: Date;
}

export interface PartitionGrant {
  readonly partitionId: string;
  readonly clientId: string;
}

export interface PrincipalRepository {
  findById(id: PrincipalId): Promise<Principal | null>;
  /** Partitions granted to the principal, with the client each belongs to. */
  listPartitionGrants(principalId: PrincipalId): Promise<readonly PartitionGrant[]>;
  upsert(draft: PrincipalDraft): Promise<Principal>;
  findPrincipalsForPartition(partitionId: PartitionId): Promise<readonly PrincipalWithGrant[]>;
  grantPartitionAccess(
    principalId: PrincipalId,
    partitionId: PartitionId,
    grantedBy: PrincipalId,
    tx?: TransactionContext,
  ): Promise<void>;
  revokePartitionAccess(
    principalId: PrincipalId,
    partitionId: PartitionId,
    tx?: TransactionContext,
  ): Promise<boolean>;
}
