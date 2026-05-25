import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Principal, PrincipalDraft } from './principal.js';
import type { PrincipalId } from './ids.js';
import type { PartitionId } from '../tenancy/ids.js';

export interface PrincipalWithGrant {
  readonly principal: Principal;
  readonly grantedAt: Date;
}

export interface PrincipalRepository {
  findById(id: PrincipalId): Promise<Principal | null>;
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

