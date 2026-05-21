/**
 * Branded IDs for the layers subdomain. `lyr_` for Layer, `lfe_` for
 * LayerFeature, `pst_` for PropertySet, `prp_` for Property — Layer,
 * LayerFeature, and PropertySet are aggregate roots and registered with
 * the AggregateRegistry prefix map. Property is a child entity managed
 * inside its parent PropertySet aggregate; its prefix is reserved for
 * row identity but Property itself is not an aggregate root.
 */
export type LayerId = string & { readonly __brand: 'LayerId' };
export type LayerFeatureId = string & { readonly __brand: 'LayerFeatureId' };
export type PropertySetId = string & { readonly __brand: 'PropertySetId' };
export type PropertyId = string & { readonly __brand: 'PropertyId' };

export const LAYER_ID_PREFIX = 'lyr' as const;
export const LAYER_FEATURE_ID_PREFIX = 'lfe' as const;
export const PROPERTY_SET_ID_PREFIX = 'pst' as const;
export const PROPERTY_ID_PREFIX = 'prp' as const;

export function asLayerId(value: string): LayerId {
  return value as LayerId;
}

export function asLayerFeatureId(value: string): LayerFeatureId {
  return value as LayerFeatureId;
}

export function asPropertySetId(value: string): PropertySetId {
  return value as PropertySetId;
}

export function asPropertyId(value: string): PropertyId {
  return value as PropertyId;
}
