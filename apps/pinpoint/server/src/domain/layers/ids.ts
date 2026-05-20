/**
 * Branded IDs for the layers subdomain. `lyr_` for Layer, `lfe_` for
 * LayerFeature — both registered with the AggregateRegistry prefix map.
 *
 * `pst_` (PropertySet) is reserved but not registered in Slice 4; the
 * aggregate scaffolding lands when a use case needs it.
 */
export type LayerId = string & { readonly __brand: 'LayerId' };
export type LayerFeatureId = string & { readonly __brand: 'LayerFeatureId' };

export const LAYER_ID_PREFIX = 'lyr' as const;
export const LAYER_FEATURE_ID_PREFIX = 'lfe' as const;

export function asLayerId(value: string): LayerId {
  return value as LayerId;
}

export function asLayerFeatureId(value: string): LayerFeatureId {
  return value as LayerFeatureId;
}
