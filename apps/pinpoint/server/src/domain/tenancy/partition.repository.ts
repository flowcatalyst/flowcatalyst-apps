import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
import type { Partition } from './partition.js';
import type { ClientId, PartitionId } from './ids.js';

export interface PartitionRepository {
  persist(aggregate: Partition, tx?: TransactionContext): Promise<Partition>;
  delete(aggregate: Partition, tx?: TransactionContext): Promise<boolean>;

  findById(id: PartitionId): Promise<Partition | null>;
  findByClientAndCode(clientId: ClientId, code: string): Promise<Partition | null>;
  listByClient(clientId: ClientId): Promise<readonly Partition[]>;
}

export interface PartitionsService {
  readonly persist: (
    aggregate: Partition,
    tx?: TransactionContext,
  ) => Effect.Effect<Partition, InfrastructureError>;
  readonly delete: (
    aggregate: Partition,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
  readonly findById: (id: PartitionId) => Effect.Effect<Partition | null, InfrastructureError>;
  readonly findByClientAndCode: (
    clientId: ClientId,
    code: string,
  ) => Effect.Effect<Partition | null, InfrastructureError>;
  readonly listByClient: (
    clientId: ClientId,
  ) => Effect.Effect<readonly Partition[], InfrastructureError>;
}

export class Partitions extends Context.Service<Partitions, PartitionsService>()(
  '@pinpoint/server/Partitions',
) {
  static layer(port: PartitionRepository): Layer.Layer<Partitions> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `PARTITION_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(Partitions, {
      persist: wrap('PERSIST', port.persist.bind(port)),
      delete: wrap('DELETE', port.delete.bind(port)),
      findById: wrap('READ', port.findById.bind(port)),
      findByClientAndCode: wrap('READ', port.findByClientAndCode.bind(port)),
      listByClient: wrap('LIST', port.listByClient.bind(port)),
    });
  }
}
