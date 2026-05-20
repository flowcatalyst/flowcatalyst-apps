import { z } from 'zod';

const PropertyValuesSchema = z.record(z.string(), z.string()).default({});

export const CreateLayerFeatureCommandSchema = z.object({
  layerId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  centerLat: z.number().optional().nullable(),
  centerLon: z.number().optional().nullable(),
  radiusMeters: z.number().positive().optional().nullable(),
  polygonGeojson: z.string().optional().nullable(),
  propertyValues: PropertyValuesSchema,
});
export type CreateLayerFeatureCommand = z.infer<typeof CreateLayerFeatureCommandSchema>;

export const UpdateLayerFeatureCommandSchema = z.object({
  featureId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  centerLat: z.number().optional().nullable(),
  centerLon: z.number().optional().nullable(),
  radiusMeters: z.number().positive().optional().nullable(),
  polygonGeojson: z.string().optional().nullable(),
  propertyValues: PropertyValuesSchema,
});
export type UpdateLayerFeatureCommand = z.infer<typeof UpdateLayerFeatureCommandSchema>;

export const DeleteLayerFeatureCommandSchema = z.object({
  featureId: z.string().trim().min(1),
});
export type DeleteLayerFeatureCommand = z.infer<typeof DeleteLayerFeatureCommandSchema>;
