import { z } from 'zod';

/**
 * Define a new property set on a layer. `name` must be unique per layer
 * (DB-enforced). Properties start empty and are populated via
 * replace-property-set-properties.
 */
export const CreatePropertySetCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  layerId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
});
export type CreatePropertySetCommand = z.infer<typeof CreatePropertySetCommandSchema>;

export const UpdatePropertySetCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  layerId: z.string().trim().min(1),
  propertySetId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
});
export type UpdatePropertySetCommand = z.infer<typeof UpdatePropertySetCommandSchema>;

export const DeletePropertySetCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  layerId: z.string().trim().min(1),
  propertySetId: z.string().trim().min(1),
});
export type DeletePropertySetCommand = z.infer<typeof DeletePropertySetCommandSchema>;

/**
 * Bulk replace the full property list of a set. Caps at 6 properties
 * to match the Rust BFF. Keys are unique per set (DB-enforced via
 * UNIQUE(property_set_id, key)).
 */
export const PropertyInputSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
});
export type PropertyInput = z.infer<typeof PropertyInputSchema>;

export const ReplacePropertySetPropertiesCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  layerId: z.string().trim().min(1),
  propertySetId: z.string().trim().min(1),
  properties: z.array(PropertyInputSchema).max(6),
});
export type ReplacePropertySetPropertiesCommand = z.infer<
  typeof ReplacePropertySetPropertiesCommandSchema
>;
