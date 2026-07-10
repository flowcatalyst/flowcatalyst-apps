import { type Static, Type } from '@sinclair/typebox';

/**
 * Wire shape for picks. Captured value objects (origin, lines) pass through
 * as stored — Type.Any() like the fulfilment DTO (Zod validates inbound).
 */
export const PickDtoSchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  type: Type.String(),
  serviceLevel: Type.String(),
  status: Type.String(),
  slotStart: Type.String(),
  slotEnd: Type.String(),
  timezone: Type.String(),
  origin: Type.Any(),
  lines: Type.Array(Type.Any()),
  requireFullPick: Type.Boolean(),
  allowSubstitutes: Type.Boolean(),
  releasedLate: Type.Boolean(),
  claimedBy: Type.Union([Type.String(), Type.Null()]),
  claimedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type PickDto = Static<typeof PickDtoSchema>;
