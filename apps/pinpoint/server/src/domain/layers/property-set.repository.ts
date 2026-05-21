import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { LayerId, PropertySetId } from './ids.js';
import type { PropertySet } from './property-set.js';

export interface PropertySetRepository {
  persist(aggregate: PropertySet, tx?: TransactionContext): Promise<PropertySet>;
  delete(aggregate: PropertySet, tx?: TransactionContext): Promise<boolean>;

  findById(id: PropertySetId): Promise<PropertySet | null>;
  findByLayerAndName(layerId: LayerId, name: string): Promise<PropertySet | null>;
  listByLayer(layerId: LayerId): Promise<readonly PropertySet[]>;

  /**
   * Batched property-set counts for the BFF layer-list endpoint. Returns
   * a Map keyed by layer id; layers with no property sets are absent.
   * Single GROUP BY query — avoids N+1 listByLayer calls.
   */
  countByLayerIds(layerIds: readonly LayerId[]): Promise<ReadonlyMap<string, number>>;
}
