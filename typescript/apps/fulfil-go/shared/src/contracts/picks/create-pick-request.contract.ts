import { z } from 'zod';
import {
  FulfilmentLineSchema,
  FulfilmentType,
  OriginLocationSchema,
  ServiceLevel,
} from '../../domain/fulfilment/value-objects.js';

/**
 * The create-pick COMMAND payload as hydrated by the fulfilment context's
 * release-part-for-pick (and delivered by the platform dispatcher to
 * POST /clients/:clientId/picks). Everything the pick context needs is
 * captured here — pick never reads fulfilment state or policy
 * (requireFullPick is the boundary translation of !allowPartialFulfilment).
 */
export const CreatePickRequestSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    fulfilmentId: z.string().min(1).max(64),
    partId: z.string().min(1).max(64),
    shortId: z.string().min(1).max(8),
    type: FulfilmentType,
    serviceLevel: ServiceLevel,
    slotStart: z.string().datetime({ offset: true }),
    slotEnd: z.string().datetime({ offset: true }),
    timezone: z.string().min(1).max(64),
    origin: OriginLocationSchema,
    lines: z.array(FulfilmentLineSchema).min(1).max(500),
    requireFullPick: z.boolean(),
    allowSubstitutes: z.boolean(),
    releasedLate: z.boolean().default(false),
  })
  .passthrough();

export type CreatePickRequest = z.infer<typeof CreatePickRequestSchema>;
