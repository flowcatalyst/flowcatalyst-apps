import { type Static, Type } from '@sinclair/typebox';

/**
 * Wire shapes for the fulfilment API. Captured value objects (locations,
 * lines, destination, …) are validated by Zod on the way IN and stored as
 * received — on the way OUT they're passed through as-is, so the response
 * schemas use Type.Any() for those nodes rather than duplicating the Zod
 * shapes in TypeBox.
 */
export const CreateFulfilmentResponseSchema = Type.Object({
  fulfilmentId: Type.String(),
  parts: Type.Array(
    Type.Object({
      partId: Type.String(),
      shortId: Type.String(),
      originRef: Type.String(),
    }),
  ),
  createdAt: Type.String(),
});
export type CreateFulfilmentResponse = Static<typeof CreateFulfilmentResponseSchema>;

export const FulfilmentPartDtoSchema = Type.Object({
  id: Type.String(),
  shortId: Type.String(),
  status: Type.String(),
  origin: Type.Any(),
  lines: Type.Array(Type.Any()),
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
  slotStart: Type.String(),
  slotEnd: Type.String(),
  timezone: Type.String(),
  destination: Type.Any(),
  policies: Type.Object({
    allowSubstitutes: Type.Boolean(),
    allowPartialFulfilment: Type.Boolean(),
  }),
  provenance: Type.Union([Type.Any(), Type.Null()]),
  additionalData: Type.Union([Type.Record(Type.String(), Type.String()), Type.Null()]),
  parts: Type.Array(FulfilmentPartDtoSchema),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type FulfilmentDto = Static<typeof FulfilmentDtoSchema>;
