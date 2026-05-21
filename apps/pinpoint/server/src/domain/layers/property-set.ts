import type { LayerId, PropertyId, PropertySetId } from './ids.js';

export const PROPERTY_SET_TYPE = 'PropertySet' as const;

/**
 * Per-key entries inside a property set. Managed inline as part of the
 * PropertySet aggregate — properties have their own row in the
 * `properties` table but are persisted/loaded together with their set,
 * never independently.
 */
export interface Property {
  readonly id: PropertyId;
  readonly propertySetId: PropertySetId;
  readonly key: string;
  readonly value: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A named bundle of canonical key/value pairs scoped to a layer. The
 * matching Rust BFF surface caps each set at six properties.
 */
export interface PropertySet {
  readonly id: PropertySetId;
  readonly layerId: LayerId;
  readonly name: string;
  readonly description: string | null;
  readonly properties: readonly Property[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePropertySetInput {
  readonly id: PropertySetId;
  readonly layerId: LayerId;
  readonly name: string;
  readonly description: string | null;
  readonly now: Date;
}

export interface UpdatePropertySetInput {
  readonly name: string;
  readonly description: string | null;
  readonly now: Date;
}

export interface ReplacePropertyInput {
  readonly id: PropertyId;
  readonly key: string;
  readonly value: string;
}

export const MAX_PROPERTIES_PER_SET = 6;

export const PropertySet = {
  create(input: CreatePropertySetInput): PropertySet {
    return {
      id: input.id,
      layerId: input.layerId,
      name: input.name,
      description: input.description,
      properties: [],
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  update(prior: PropertySet, input: UpdatePropertySetInput): PropertySet {
    return {
      ...prior,
      name: input.name,
      description: input.description,
      updatedAt: input.now,
    };
  },

  /**
   * Replace the full property list. Mirrors Rust's `replace_properties`
   * — drop everything, insert the new set. Capped at MAX_PROPERTIES_PER_SET.
   */
  replaceProperties(
    prior: PropertySet,
    incoming: readonly ReplacePropertyInput[],
    now: Date,
  ): PropertySet {
    const properties: Property[] = incoming.map((p) => ({
      id: p.id,
      propertySetId: prior.id,
      key: p.key,
      value: p.value,
      createdAt: now,
      updatedAt: now,
    }));
    return {
      ...prior,
      properties,
      updatedAt: now,
    };
  },
} as const;
