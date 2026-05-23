import { Context, Effect, Layer as EffectLayer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
import type { ClientId } from '../tenancy/ids.js';
import type { Layer } from './layer.js';
import type { LayerId } from './ids.js';

export interface ListLayersQuery {
  readonly clientId: ClientId;
  readonly limit: number;
  readonly offset: number;
}

export interface ListLayersResult {
  readonly layers: readonly Layer[];
  readonly total: number;
}

export interface LayerRepository {
  persist(aggregate: Layer, tx?: TransactionContext): Promise<Layer>;
  delete(aggregate: Layer, tx?: TransactionContext): Promise<boolean>;

  findById(id: LayerId): Promise<Layer | null>;
  findByClientAndCode(clientId: ClientId, code: string): Promise<Layer | null>;
  listByClient(query: ListLayersQuery): Promise<ListLayersResult>;
  findPartitionIds(layerId: LayerId): Promise<readonly string[]>;
  setPartitionIds(layerId: LayerId, partitionIds: readonly string[]): Promise<void>;
}

export interface LayersService {
  readonly persist: (
    aggregate: Layer,
    tx?: TransactionContext,
  ) => Effect.Effect<Layer, InfrastructureError>;
  readonly delete: (
    aggregate: Layer,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
  readonly findById: (id: LayerId) => Effect.Effect<Layer | null, InfrastructureError>;
  readonly findByClientAndCode: (
    clientId: ClientId,
    code: string,
  ) => Effect.Effect<Layer | null, InfrastructureError>;
  readonly listByClient: (
    query: ListLayersQuery,
  ) => Effect.Effect<ListLayersResult, InfrastructureError>;
  readonly findPartitionIds: (
    layerId: LayerId,
  ) => Effect.Effect<readonly string[], InfrastructureError>;
  readonly setPartitionIds: (
    layerId: LayerId,
    partitionIds: readonly string[],
  ) => Effect.Effect<void, InfrastructureError>;
}

export class Layers extends Context.Service<Layers, LayersService>()('@pinpoint/server/Layers') {
  static layer(port: LayerRepository): EffectLayer.Layer<Layers> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `LAYER_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return EffectLayer.succeed(Layers, {
      persist: wrap('PERSIST', port.persist.bind(port)),
      delete: wrap('DELETE', port.delete.bind(port)),
      findById: wrap('READ', port.findById.bind(port)),
      findByClientAndCode: wrap('READ', port.findByClientAndCode.bind(port)),
      listByClient: wrap('LIST', port.listByClient.bind(port)),
      findPartitionIds: wrap('READ', port.findPartitionIds.bind(port)),
      setPartitionIds: wrap('WRITE', port.setPartitionIds.bind(port)),
    });
  }
}
