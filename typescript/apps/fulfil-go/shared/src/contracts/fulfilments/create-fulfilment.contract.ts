import { z } from 'zod';
import {
  AdditionalDataSchema,
  DestinationSchema,
  FulfilmentLineSchema,
  FulfilmentPoliciesSchema,
  FulfilmentType,
  OriginLocationSchema,
  ProvenanceSchema,
  ServiceLevel,
} from '../../domain/fulfilment/value-objects.js';

export const CreateFulfilmentPartInputSchema = z
  .object({
    origin: OriginLocationSchema,
    lines: z.array(FulfilmentLineSchema).min(1).max(500),
  })
  .strict();
export type CreateFulfilmentPartInput = z.infer<typeof CreateFulfilmentPartInputSchema>;

/**
 * Command for creating a fulfilment. Immutable once created (cancel-only).
 * Idempotent on (clientId, externalSource, externalRef) — a duplicate create
 * returns FULFILMENT_ALREADY_EXISTS with the existing id in details.
 *
 * `clientId` is injected by the route from the /clients/:clientId path.
 */
export const CreateFulfilmentCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    externalSource: z.string().min(1).max(64),
    externalRef: z.string().min(1).max(128),
    type: FulfilmentType,
    serviceLevel: ServiceLevel,
    slotStart: z.string().datetime({ offset: true }),
    slotEnd: z.string().datetime({ offset: true }),
    /** IANA timezone — display + day-scoping only, never arithmetic. */
    timezone: z.string().min(1).max(64),
    /**
     * Pick lead time (minutes before slotStart that parts become releasable
     * to the pick context). The creating integration passes per-store or
     * global settings from upstream; defaults apply when absent (90 delivery
     * / 60 collect). Ignored for ASAP — those release immediately.
     */
    pickLeadTimeMinutes: z.number().int().min(0).max(1440).optional(),
    destination: DestinationSchema,
    policies: FulfilmentPoliciesSchema,
    provenance: ProvenanceSchema.optional(),
    additionalData: AdditionalDataSchema.optional(),
    parts: z.array(CreateFulfilmentPartInputSchema).min(1).max(20),
  })
  .strict();

export type CreateFulfilmentCommand = z.infer<typeof CreateFulfilmentCommandSchema>;
