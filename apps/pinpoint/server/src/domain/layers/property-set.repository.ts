import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
import type { LayerId, PropertySetId } from './ids.js';
import type { PropertySet } from './property-set.js';

export interface PropertySetRepository {
  persist(aggregate: PropertySet, tx?: TransactionContext): Promise<PropertySet>;
  delete(aggregate: PropertySet, tx?: TransactionContext): Promise<boolean>;

  findById(id: PropertySetId): Promise<PropertySet | null>;
  findByLayerAndName(layerId: LayerId, name: string): Promise<PropertySet | null>;
  listByLayer(layerId: LayerId): Promise<readonly PropertySet[]>;
  countByLayerIds(layerIds: readonly LayerId[]): Promise<ReadonlyMap<string, number>>;
}

export interface PropertySetsService {
  readonly persist: (
    aggregate: PropertySet,
    tx?: TransactionContext,
  ) => Effect.Effect<PropertySet, InfrastructureError>;
  readonly delete: (
    aggregate: PropertySet,
    tx?: TransactionContext,
  ) => Effect.Effect<boolean, InfrastructureError>;
  readonly findById: (id: PropertySetId) => Effect.Effect<PropertySet | null, InfrastructureError>;
  readonly findByLayerAndName: (
    layerId: LayerId,
    name: string,
  ) => Effect.Effect<PropertySet | null, InfrastructureError>;
  readonly listByLayer: (
    layerId: LayerId,
  ) => Effect.Effect<readonly PropertySet[], InfrastructureError>;
  readonly countByLayerIds: (
    layerIds: readonly LayerId[],
  ) => Effect.Effect<ReadonlyMap<string, number>, InfrastructureError>;
}

export class PropertySets extends Context.Service<PropertySets, PropertySetsService>()(
  '@pinpoint/server/PropertySets',
) {
  static layer(port: PropertySetRepository): Layer.Layer<PropertySets> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `PROPERTY_SET_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(PropertySets, {
      persist: wrap('PERSIST', port.persist.bind(port)),
      delete: wrap('DELETE', port.delete.bind(port)),
      findById: wrap('READ', port.findById.bind(port)),
      findByLayerAndName: wrap('READ', port.findByLayerAndName.bind(port)),
      listByLayer: wrap('LIST', port.listByLayer.bind(port)),
      countByLayerIds: wrap('LIST', port.countByLayerIds.bind(port)),
    });
  }
}
