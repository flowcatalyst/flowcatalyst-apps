import type { PickDto } from '@fulfil-go/shared';
import type { Pick } from './pick.js';

/** Aggregate → wire shape. Captured value objects pass through as stored. */
export function toPickDto(pick: Pick): PickDto {
  return {
    id: pick.id,
    clientId: pick.clientId,
    storeRef: pick.storeRef,
    fulfilmentId: pick.fulfilmentId,
    partId: pick.partId,
    shortId: pick.shortId,
    type: pick.type,
    serviceLevel: pick.serviceLevel,
    status: pick.status,
    slotStart: pick.slotStart.toISOString(),
    slotEnd: pick.slotEnd.toISOString(),
    timezone: pick.timezone,
    origin: pick.origin,
    lines: [...pick.lines],
    requireFullPick: pick.requireFullPick,
    allowSubstitutes: pick.allowSubstitutes,
    releasedLate: pick.releasedLate,
    sortAlgorithm: pick.sortAlgorithm,
    claimedBy: pick.claimedBy,
    claimedAt: pick.claimedAt?.toISOString() ?? null,
    lineResults: pick.lineResults
      ? pick.lineResults.map((r) => ({
          externalLineRef: r.externalLineRef,
          pickedQuantity: r.pickedQuantity,
          ...(r.substitutions ? { substitutions: r.substitutions.map((s) => ({ ...s })) } : {}),
        }))
      : null,
    packages: pick.packages ? [...pick.packages] : null,
    labels: pick.labels
      ? {
          count: pick.labels.count,
          labels: pick.labels.labels.map((l) => ({ ...l })),
          voidedRefs: [...pick.labels.voidedRefs],
        }
      : null,
    requiresCarOrLarger: pick.requiresCarOrLarger,
    completedAt: pick.completedAt?.toISOString() ?? null,
    failReason: pick.failReason,
    createdAt: pick.createdAt.toISOString(),
    updatedAt: pick.updatedAt.toISOString(),
  };
}
