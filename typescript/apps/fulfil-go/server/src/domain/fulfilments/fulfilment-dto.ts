import type { FulfilmentDto } from '@fulfil-go/shared';
import type { Fulfilment } from './fulfilment.js';

/** Aggregate → wire shape. Captured value objects pass through as stored. */
export function toFulfilmentDto(fulfilment: Fulfilment): FulfilmentDto {
  return {
    id: fulfilment.id,
    clientId: fulfilment.clientId,
    externalSource: fulfilment.externalSource,
    externalRef: fulfilment.externalRef,
    type: fulfilment.type,
    serviceLevel: fulfilment.serviceLevel,
    status: fulfilment.status,
    slotStart: fulfilment.slotStart.toISOString(),
    slotEnd: fulfilment.slotEnd.toISOString(),
    timezone: fulfilment.timezone,
    destination: fulfilment.destination,
    policies: fulfilment.policies,
    provenance: fulfilment.provenance,
    additionalData: fulfilment.additionalData,
    parts: fulfilment.parts.map((part) => ({
      id: part.id,
      shortId: part.shortId,
      status: part.status,
      origin: part.origin,
      lines: [...part.lines],
    })),
    createdAt: fulfilment.createdAt.toISOString(),
    updatedAt: fulfilment.updatedAt.toISOString(),
  };
}
