import { type Static, Type } from '@sinclair/typebox';

/**
 * Wire shapes for the fulfilment API. Captured value objects (locations,
 * lines, destination, …) are validated by Zod on the way IN and stored as
 * received — on the way OUT they're passed through as-is, so the response
 * schemas use Type.Any() for those nodes rather than duplicating the Zod
 * shapes in TypeBox.
 */
/**
 * Handover pins as returned to the CREATING integration (upstream pulls;
 * docs/handover-verification.md) and by the audited reveal endpoint — the
 * client's commerce system messages the customer. Pins never appear on
 * list/detail DTOs or events.
 */
export const HandoverPinsSchema = Type.Object({
  deliveryPin: Type.Union([Type.String(), Type.Null()]),
  pickupPins: Type.Array(
    Type.Object({
      partId: Type.String(),
      shortId: Type.String(),
      originRef: Type.String(),
      pin: Type.String(),
    }),
  ),
});
export type HandoverPinsDto = Static<typeof HandoverPinsSchema>;

export const CreateFulfilmentResponseSchema = Type.Object({
  fulfilmentId: Type.String(),
  parts: Type.Array(
    Type.Object({
      partId: Type.String(),
      shortId: Type.String(),
      originRef: Type.String(),
    }),
  ),
  /** Generated handover pins (per the client's fulfilment settings). */
  handover: HandoverPinsSchema,
  createdAt: Type.String(),
});
export type CreateFulfilmentResponse = Static<typeof CreateFulfilmentResponseSchema>;

export const FulfilmentPartDtoSchema = Type.Object({
  id: Type.String(),
  shortId: Type.String(),
  status: Type.String(),
  origin: Type.Any(),
  lines: Type.Array(Type.Any()),
  /** Pick ACTUALS captured from part:picked — null until the pick completes. */
  lineResults: Type.Union([Type.Array(Type.Any()), Type.Null()]),
  packages: Type.Union([Type.Array(Type.Any()), Type.Null()]),
  requiresCarOrLarger: Type.Union([Type.Boolean(), Type.Null()]),
});
export type FulfilmentPartDto = Static<typeof FulfilmentPartDtoSchema>;

export const FulfilmentDtoSchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  externalSource: Type.String(),
  externalRef: Type.String(),
  type: Type.String(),
  serviceLevel: Type.String(),
  status: Type.String(),
  /** Core process-definition stamp (registry code, resolved at creation). */
  processDefinition: Type.String(),
  slotStart: Type.String(),
  slotEnd: Type.String(),
  timezone: Type.String(),
  destination: Type.Any(),
  policies: Type.Object({
    allowSubstitutes: Type.Boolean(),
    allowPartialFulfilment: Type.Boolean(),
  }),
  /** Handover policy STAMP (non-secret; pin VALUES only via audited reveal). */
  handoverPolicy: Type.Union([Type.Any(), Type.Null()]),
  /** Highest line restrictedMinAge; null = nothing age-restricted. */
  maxRestrictedAge: Type.Union([Type.Integer(), Type.Null()]),
  provenance: Type.Union([Type.Any(), Type.Null()]),
  additionalData: Type.Union([Type.Record(Type.String(), Type.String()), Type.Null()]),
  parts: Type.Array(FulfilmentPartDtoSchema),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type FulfilmentDto = Static<typeof FulfilmentDtoSchema>;
