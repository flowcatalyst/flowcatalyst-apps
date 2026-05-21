import { z } from 'zod';

export const LayerKindSchema = z.enum(['RADIUS', 'POLYGON', 'POINT']);
export type LayerKind = z.infer<typeof LayerKindSchema>;

export const CreateLayerCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  layerType: LayerKindSchema,
  centerLat: z.number().optional().nullable(),
  centerLon: z.number().optional().nullable(),
  radiusMeters: z.number().positive().optional().nullable(),
  polygonGeojson: z.string().optional().nullable(),
});
export type CreateLayerCommand = z.infer<typeof CreateLayerCommandSchema>;

export const LayerStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type LayerStatus = z.infer<typeof LayerStatusSchema>;

/**
 * Update layer. `code` is immutable (re-issuing requires delete+create).
 * `layerType` is also immutable — switching a RADIUS layer to POLYGON
 * would invalidate every existing feature's geometry, so requires a
 * new layer.
 */
export const UpdateLayerCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  layerId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  centerLat: z.number().optional().nullable(),
  centerLon: z.number().optional().nullable(),
  radiusMeters: z.number().positive().optional().nullable(),
  polygonGeojson: z.string().optional().nullable(),
  status: LayerStatusSchema.optional(),
});
export type UpdateLayerCommand = z.infer<typeof UpdateLayerCommandSchema>;

export const DeleteLayerCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  layerId: z.string().trim().min(1),
});
export type DeleteLayerCommand = z.infer<typeof DeleteLayerCommandSchema>;
