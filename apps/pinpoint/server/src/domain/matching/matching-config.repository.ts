import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { MatchingConfig } from './matching-config.js';
import type { MatchingConfigId } from './ids.js';

export interface MatchingConfigRepository {
  persist(aggregate: MatchingConfig, tx?: TransactionContext): Promise<MatchingConfig>;
  delete(aggregate: MatchingConfig, tx?: TransactionContext): Promise<boolean>;

  findById(id: MatchingConfigId): Promise<MatchingConfig | null>;
  resolve(
    clientId: ClientId | null,
    partitionId: PartitionId | null,
  ): Promise<MatchingConfig>;
}

export interface MatchingConfigsService {
  readonly persist: (
    aggregate: MatchingConfig,
    tx?: TransactionContext,
  ) => Effect.Effect<MatchingConfig, InfrastructureError>;
  readonly delete: (
    aggregate: MatchingConfig,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
  readonly findById: (
    id: MatchingConfigId,
  ) => Effect.Effect<MatchingConfig | null, InfrastructureError>;
  readonly resolve: (
    clientId: ClientId | null,
    partitionId: PartitionId | null,
  ) => Effect.Effect<MatchingConfig, InfrastructureError>;
}

export class MatchingConfigs extends Context.Service<
  MatchingConfigs,
  MatchingConfigsService
>()('@pinpoint/server/MatchingConfigs') {
  static layer(port: MatchingConfigRepository): Layer.Layer<MatchingConfigs> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `MATCHING_CONFIG_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(MatchingConfigs, {
      persist: wrap('PERSIST', port.persist.bind(port)),
      delete: wrap('DELETE', port.delete.bind(port)),
      findById: wrap('READ', port.findById.bind(port)),
      resolve: wrap('RESOLVE', port.resolve.bind(port)),
    });
  }
}
