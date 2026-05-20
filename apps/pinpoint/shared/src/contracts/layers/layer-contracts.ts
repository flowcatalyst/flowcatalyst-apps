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
