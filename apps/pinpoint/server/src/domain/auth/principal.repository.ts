import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Principal, PrincipalDraft } from './principal.js';
import type { PrincipalId } from './ids.js';
import type { PartitionId } from '../tenancy/ids.js';

/**
 * A principal joined with the `granted_at` timestamp from its
 * principal_partitions row, used by the BFF "who has access to this
 * partition?" list view.
 */
export interface PrincipalWithGrant {
  readonly principal: Principal;
  readonly grantedAt: Date;
}

export interface PrincipalRepository {
  findById(id: PrincipalId): Promise<Principal | null>;

  /**
   * Insert or update a principal by id. Returns the persisted row.
   *
   * Used by the auth flow — on first authenticated request (or OIDC
   * callback in a later slice), the principal is upserted from token
   * claims so subsequent reads can resolve it.
   */
  upsert(draft: PrincipalDraft): Promise<Principal>;

  /** List principals that have access to a given partition, ordered by grant time. */
  findPrincipalsForPartition(partitionId: PartitionId): Promise<readonly PrincipalWithGrant[]>;

  /**
   * Grant `principalId` access to `partitionId`. Idempotent: re-granting
   * is a no-op (the existing row is left alone — `granted_by` and
   * `granted_at` are preserved on conflict).
   */
  grantPartitionAccess(
    principalId: PrincipalId,
    partitionId: PartitionId,
    grantedBy: PrincipalId,
    tx?: TransactionContext,
  ): Promise<void>;

  /** Returns true if a row was actually deleted; false if the grant did not exist. */
  revokePartitionAccess(
    principalId: PrincipalId,
    partitionId: PartitionId,
    tx?: TransactionContext,
  ): Promise<boolean>;
}
