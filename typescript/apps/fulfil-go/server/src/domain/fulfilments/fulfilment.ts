import type {
  AdditionalData,
  Destination,
  FulfilmentLine,
  FulfilmentPolicies,
  FulfilmentStatus,
  FulfilmentType,
  HandoverPolicy,
  OriginLocation,
  PartStatus,
  Provenance,
  ServiceLevel,
} from '@fulfil-go/shared';
import type { FulfilmentId, FulfilmentPartId } from './ids.js';

export const FULFILMENT_TYPE = 'Fulfilment' as const;

/**
 * The coordinator aggregate (see docs/fulfilment-context.md). Immutable
 * after creation except for process state — no amendments, cancel only.
 * Parts are the unit of coordination (one origin, its lines, its pick);
 * they live inside this aggregate boundary and persist with it.
 */
/**
 * Pick ACTUALS as captured from the pick context's part:picked event — the
 * fulfilment's own record of what physically happened (it never reads back
 * into the pick context). Shapes mirror the event payload.
 */
export interface PartLineActual {
  readonly externalLineRef: string;
  readonly pickedQuantity: number;
  readonly substitutions?: readonly {
    barcode: string;
    description: string | null;
    quantity: number;
  }[];
}

export interface PartPackageActual {
  readonly ref: string;
  readonly kind: string;
  readonly size: string | null;
  readonly temperature: string;
  /** Stamped at pick completion (docs/bag-sizing.md); absent pre-feature. */
  readonly construction?: string;
  readonly dims?: { lengthMm: number; widthMm: number; heightMm: number } | null;
  readonly items: readonly { externalLineRef: string; quantity: number }[] | null;
}

export interface PartPickActuals {
  readonly lineResults: readonly PartLineActual[];
  readonly packages: readonly PartPackageActual[];
  /** Picker-supplied: moving this part needs a vehicle (transport input). */
  readonly requiresCarOrLarger: boolean | null;
}

export interface FulfilmentPart {
  readonly id: FulfilmentPartId;
  /** 4–6 digit human quick-reference; unique per (client, store, service-day). */
  readonly shortId: string;
  readonly status: PartStatus;
  readonly origin: OriginLocation;
  readonly lines: readonly FulfilmentLine[];
  /** When this part becomes eligible for pick release (precomputed, immutable). */
  readonly releaseAt: Date;
  /**
   * Store→driver handover code (docs/handover-verification.md): the store
   * reads it out when a driver can't scan. Null when the stamped policy has
   * pickup pins off (and on pre-feature rows). SECRET-ish: never on events,
   * DTOs, or the driver app — reveal is a dedicated audited read.
   */
  readonly pickupPin: string | null;
  /** Captured on part:picked — null until the pick completes. */
  readonly lineResults: readonly PartLineActual[] | null;
  readonly packages: readonly PartPackageActual[] | null;
  readonly requiresCarOrLarger: boolean | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Fulfilment {
  readonly id: FulfilmentId;
  readonly clientId: string;
  readonly externalSource: string;
  readonly externalRef: string;
  readonly type: FulfilmentType;
  readonly serviceLevel: ServiceLevel;
  readonly status: FulfilmentStatus;
  /**
   * OWNERSHIP STAMP: the core process-definition code coordinating this
   * fulfilment (resolved from client settings at creation, immutable).
   * Reactions check the stamp before acting — a client config change
   * migrates new fulfilments only.
   */
  readonly processDefinition: string;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly timezone: string;
  readonly destination: Destination;
  readonly policies: FulfilmentPolicies;
  /**
   * HANDOVER POLICY STAMP (docs/handover-verification.md) — client fulfilment
   * settings resolved at creation, immutable (processDefinition pattern).
   * Null only on pre-feature rows: readers treat null as everything-off.
   */
  readonly handoverPolicy: HandoverPolicy | null;
  /** Customer handover code — one per fulfilment; see FulfilmentPart.pickupPin. */
  readonly deliveryPin: string | null;
  /** Highest restrictedMinAge across all lines; null = nothing restricted. */
  readonly maxRestrictedAge: number | null;
  readonly provenance: Provenance | null;
  readonly additionalData: AdditionalData | null;
  readonly parts: readonly FulfilmentPart[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateFulfilmentPartInput {
  readonly id: FulfilmentPartId;
  readonly shortId: string;
  readonly releaseAt: Date;
  readonly origin: OriginLocation;
  readonly lines: readonly FulfilmentLine[];
  readonly pickupPin: string | null;
}

export interface CreateFulfilmentInput {
  readonly id: FulfilmentId;
  readonly clientId: string;
  readonly externalSource: string;
  readonly externalRef: string;
  readonly type: FulfilmentType;
  readonly serviceLevel: ServiceLevel;
  readonly processDefinition: string;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly timezone: string;
  readonly destination: Destination;
  readonly policies: FulfilmentPolicies;
  readonly handoverPolicy: HandoverPolicy;
  readonly deliveryPin: string | null;
  readonly maxRestrictedAge: number | null;
  readonly provenance: Provenance | null;
  readonly additionalData: AdditionalData | null;
  readonly parts: readonly CreateFulfilmentPartInput[];
  readonly now: Date;
}

export const Fulfilment = {
  create(input: CreateFulfilmentInput): Fulfilment {
    return {
      id: input.id,
      clientId: input.clientId,
      externalSource: input.externalSource,
      externalRef: input.externalRef,
      type: input.type,
      serviceLevel: input.serviceLevel,
      status: 'created',
      processDefinition: input.processDefinition,
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      timezone: input.timezone,
      destination: input.destination,
      policies: input.policies,
      handoverPolicy: input.handoverPolicy,
      deliveryPin: input.deliveryPin,
      maxRestrictedAge: input.maxRestrictedAge,
      provenance: input.provenance,
      additionalData: input.additionalData,
      parts: input.parts.map((part) => ({
        id: part.id,
        shortId: part.shortId,
        releaseAt: part.releaseAt,
        status: 'pending',
        origin: part.origin,
        lines: part.lines,
        pickupPin: part.pickupPin,
        lineResults: null,
        packages: null,
        requiresCarOrLarger: null,
        createdAt: input.now,
        updatedAt: input.now,
      })),
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /**
   * Release one pending part to the pick context: `pending → pick_requested`.
   * First release also moves the fulfilment `created → in_progress`.
   */
  releasePart(prior: Fulfilment, partId: FulfilmentPartId, now: Date): Fulfilment {
    return {
      ...prior,
      status: prior.status === 'created' ? 'in_progress' : prior.status,
      parts: prior.parts.map((part) =>
        part.id === partId && part.status === 'pending'
          ? { ...part, status: 'pick_requested', updatedAt: now }
          : part,
      ),
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  /**
   * PROCESS MANAGER transitions — reactions to pick-context events delivered
   * via the platform subscription (see operations/fulfilment-pick-process).
   * All are per-part; the fulfilment status stays `in_progress` while parts
   * progress and only moves at the derivation points below.
   */

  /** `pick_requested → picking` — a picker claimed the pick. */
  partPicking(prior: Fulfilment, partId: FulfilmentPartId, now: Date): Fulfilment {
    return {
      ...prior,
      parts: prior.parts.map((part) =>
        part.id === partId && part.status === 'pick_requested'
          ? { ...part, status: 'picking', updatedAt: now }
          : part,
      ),
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  /**
   * `pick_requested|picking → picked|short_picked` — the pick completed.
   * Captures the ACTUALS (line results, parcels, vehicle flag) onto the part.
   */
  partPickOutcome(
    prior: Fulfilment,
    partId: FulfilmentPartId,
    short: boolean,
    actuals: PartPickActuals,
    now: Date,
  ): Fulfilment {
    return {
      ...prior,
      parts: prior.parts.map((part) =>
        part.id === partId && (part.status === 'pick_requested' || part.status === 'picking')
          ? {
              ...part,
              status: short ? 'short_picked' : 'picked',
              lineResults: actuals.lineResults,
              packages: actuals.packages,
              requiresCarOrLarger: actuals.requiresCarOrLarger,
              updatedAt: now,
            }
          : part,
      ),
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  /**
   * SUPERVISOR re-stamp of a picked part's car-or-larger requirement
   * (Andrew, 2026-07-14): valid only while the part sits picked/short_picked
   * and no transport order exists — the caller guards the transport check.
   */
  partCarFlag(
    prior: Fulfilment,
    partId: FulfilmentPartId,
    requiresCarOrLarger: boolean,
    now: Date,
  ): Fulfilment {
    return {
      ...prior,
      parts: prior.parts.map((part) =>
        part.id === partId && (part.status === 'picked' || part.status === 'short_picked')
          ? { ...part, requiresCarOrLarger, updatedAt: now }
          : part,
      ),
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  /** Any non-terminal part → failed — the picker could not fulfil. */
  partFailed(prior: Fulfilment, partId: FulfilmentPartId, now: Date): Fulfilment {
    return {
      ...prior,
      parts: prior.parts.map((part) =>
        part.id === partId &&
        part.status !== 'completed' &&
        part.status !== 'cancelled' &&
        part.status !== 'failed'
          ? { ...part, status: 'failed', updatedAt: now }
          : part,
      ),
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  /** Parts still in play — not failed and not cancelled. */
  viableParts(fulfilment: Fulfilment): readonly FulfilmentPart[] {
    return fulfilment.parts.filter((p) => p.status !== 'failed' && p.status !== 'cancelled');
  },

  /** True when every viable part has finished picking (and at least one exists). */
  allViablePicked(fulfilment: Fulfilment): boolean {
    const viable = Fulfilment.viableParts(fulfilment);
    return (
      viable.length > 0 && viable.every((p) => p.status === 'picked' || p.status === 'short_picked')
    );
  },

  /**
   * `in_progress → ready` — everything pickable is picked; awaiting transport.
   * NO version bump: this always COMPOSES with a part transition in the same
   * commit (which owns the bump) — a second bump would break the optimistic
   * `version - 1` persist guard.
   */
  markReady(prior: Fulfilment, now: Date): Fulfilment {
    return { ...prior, status: 'ready', updatedAt: now };
  },

  /**
   * Fail the fulfilment: cancels every part still in play (failed parts stay
   * failed — they're the cause, not a casualty). Used by the all-or-nothing
   * policy fan-out and when no viable parts remain. NO version bump — see
   * markReady: it composes with the triggering part transition's commit.
   */
  failFulfilment(prior: Fulfilment, now: Date): Fulfilment {
    return {
      ...prior,
      status: 'failed',
      parts: prior.parts.map((part) =>
        part.status === 'completed' || part.status === 'cancelled' || part.status === 'failed'
          ? part
          : { ...part, status: 'cancelled', updatedAt: now },
      ),
      updatedAt: now,
    };
  },

  /**
   * Cancel-only mutability. While nothing is in flight (no picks dispatched
   * yet) cancellation is synchronous: straight to `cancelled`, all
   * non-terminal parts with it. Once the process manager exists, cancel from
   * `in_progress` goes through `cancelling` and awaits the fan-out instead.
   */
  cancel(prior: Fulfilment, now: Date): Fulfilment {
    return {
      ...prior,
      status: 'cancelled',
      parts: prior.parts.map((part) =>
        part.status === 'completed' || part.status === 'cancelled'
          ? part
          : { ...part, status: 'cancelled', updatedAt: now },
      ),
      version: prior.version + 1,
      updatedAt: now,
    };
  },
} as const;
