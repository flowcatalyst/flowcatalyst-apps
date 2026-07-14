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
    processDefinition: fulfilment.processDefinition,
    slotStart: fulfilment.slotStart.toISOString(),
    slotEnd: fulfilment.slotEnd.toISOString(),
    timezone: fulfilment.timezone,
    destination: fulfilment.destination,
    policies: fulfilment.policies,
    // Policy stamp is non-secret; PIN VALUES deliberately never map here —
    // the audited handover-pins endpoint is the only reveal.
    handoverPolicy: fulfilment.handoverPolicy,
    maxRestrictedAge: fulfilment.maxRestrictedAge,
    provenance: fulfilment.provenance,
    additionalData: fulfilment.additionalData,
    parts: fulfilment.parts.map((part) => ({
      id: part.id,
      shortId: part.shortId,
      status: part.status,
      origin: part.origin,
      lines: [...part.lines],
      lineResults: part.lineResults ? [...part.lineResults] : null,
      packages: part.packages ? [...part.packages] : null,
      requiresCarOrLarger: part.requiresCarOrLarger,
    })),
    createdAt: fulfilment.createdAt.toISOString(),
    updatedAt: fulfilment.updatedAt.toISOString(),
  };
}
