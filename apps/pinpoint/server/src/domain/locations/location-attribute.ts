import type { LocationAttributeId, LocationId } from './ids.js';

/**
 * Free-form key/value attribute attached to a `Location`. The value column
 * is JSONB so it can carry either a single string or an array of strings,
 * mirroring the Rust `AttributeValue` untagged enum.
 *
 * LocationAttribute is a child entity of Location — it has its own row +
 * TSID-shaped id but is never persisted independently. The create-location
 * use case writes attributes through `LocationAttributeRepository` after
 * the parent Location commits in the same transaction.
 */
export type AttributeValue = string | readonly string[];

export interface LocationAttribute {
  readonly id: LocationAttributeId;
  readonly locationId: LocationId;
  readonly key: string;
  readonly value: AttributeValue;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AttributeInput {
  readonly key: string;
  readonly value: AttributeValue;
}
