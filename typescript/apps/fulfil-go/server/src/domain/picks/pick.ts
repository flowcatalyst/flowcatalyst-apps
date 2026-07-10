import type {
  FulfilmentLine,
  FulfilmentType,
  OriginLocation,
  ServiceLevel,
} from '@fulfil-go/shared';
import type { PickId } from './ids.js';

export const PICK_TYPE = 'Pick' as const;

/**
 * Pick lifecycle. This slice implements requested → claimed; the picking
 * flow (picking/picked/short_picked/…) lands with the scan workflow.
 */
export type PickStatus = 'requested' | 'claimed';

/**
 * The pick context's work item — one part's pick at one store, created from
 * the fulfilment context's create-pick command (via the platform dispatcher).
 * Carries everything captured on the command; never reads back into the
 * fulfilment aggregate. `storeRef` (= origin.ref) scopes picker visibility
 * and claiming.
 */
export interface Pick {
  readonly id: PickId;
  readonly clientId: string;
  readonly storeRef: string;
  readonly fulfilmentId: string;
  /** Unique per client — the create-pick idempotency key. */
  readonly partId: string;
  readonly shortId: string;
  readonly type: FulfilmentType;
  readonly serviceLevel: ServiceLevel;
  readonly status: PickStatus;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly timezone: string;
  readonly origin: OriginLocation;
  readonly lines: readonly FulfilmentLine[];
  readonly requireFullPick: boolean;
  readonly allowSubstitutes: boolean;
  readonly releasedLate: boolean;
  /** Picker (pkr_…) who claimed this pick. */
  readonly claimedBy: string | null;
  readonly claimedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePickInput {
  readonly id: PickId;
  readonly clientId: string;
  readonly fulfilmentId: string;
  readonly partId: string;
  readonly shortId: string;
  readonly type: FulfilmentType;
  readonly serviceLevel: ServiceLevel;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly timezone: string;
  readonly origin: OriginLocation;
  readonly lines: readonly FulfilmentLine[];
  readonly requireFullPick: boolean;
  readonly allowSubstitutes: boolean;
  readonly releasedLate: boolean;
  readonly now: Date;
}

export const Pick = {
  create(input: CreatePickInput): Pick {
    return {
      id: input.id,
      clientId: input.clientId,
      storeRef: input.origin.ref,
      fulfilmentId: input.fulfilmentId,
      partId: input.partId,
      shortId: input.shortId,
      type: input.type,
      serviceLevel: input.serviceLevel,
      status: 'requested',
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      timezone: input.timezone,
      origin: input.origin,
      lines: input.lines,
      requireFullPick: input.requireFullPick,
      allowSubstitutes: input.allowSubstitutes,
      releasedLate: input.releasedLate,
      claimedBy: null,
      claimedAt: null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /** `requested → claimed`. Guarded by the use case; optimistic lock backstops races. */
  claim(prior: Pick, pickerId: string, now: Date): Pick {
    return {
      ...prior,
      status: 'claimed',
      claimedBy: pickerId,
      claimedAt: now,
      version: prior.version + 1,
      updatedAt: now,
    };
  },
} as const;
