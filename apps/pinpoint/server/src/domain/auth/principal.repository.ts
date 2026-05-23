import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
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

export interface PrincipalsService {
  readonly findById: (id: PrincipalId) => Effect.Effect<Principal | null, InfrastructureError>;
  readonly upsert: (draft: PrincipalDraft) => Effect.Effect<Principal, InfrastructureError>;
  readonly findPrincipalsForPartition: (
    partitionId: PartitionId,
  ) => Effect.Effect<readonly PrincipalWithGrant[], InfrastructureError>;
  readonly grantPartitionAccess: (
    principalId: PrincipalId,
    partitionId: PartitionId,
    grantedBy: PrincipalId,
    tx?: TransactionContext,
  ) => Effect.Effect<void, InfrastructureError>;
  readonly revokePartitionAccess: (
    principalId: PrincipalId,
    partitionId: PartitionId,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
}

export class Principals extends Context.Service<Principals, PrincipalsService>()(
  '@pinpoint/server/Principals',
) {
  static layer(port: PrincipalRepository): Layer.Layer<Principals> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `PRINCIPAL_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(Principals, {
      findById: wrap('READ', port.findById.bind(port)),
      upsert: wrap('UPSERT', port.upsert.bind(port)),
      findPrincipalsForPartition: wrap('READ', port.findPrincipalsForPartition.bind(port)),
      grantPartitionAccess: wrap('GRANT', port.grantPartitionAccess.bind(port)),
      revokePartitionAccess: wrap('REVOKE', port.revokePartitionAccess.bind(port)),
    });
  }
}
