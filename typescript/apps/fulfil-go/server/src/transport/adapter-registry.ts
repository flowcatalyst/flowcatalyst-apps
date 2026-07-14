import type { TransportProviderAdapter } from './provider-port.js';

/**
 * Transport provider registry (docs/transport-context.md "Provider
 * selection & coverage"): providers are CODE — store/client config only
 * references codes, validated against this registry.
 *
 * Two planning kinds (who builds trips):
 * - 'provider-planned' (uber): the port adapter is the whole integration —
 *   quote/book/track; the book landing pad drives orders to `booked`.
 * - 'our-planned' ('own', 'epod'): the "adapter" is thin — orders stay
 *   `requested` for OUR planning context (one offer/claim marketplace; the
 *   execution app consumes it natively, EPOD via the Integral claim proxy).
 */
export interface ProviderChannel {
  readonly code: string;
  readonly kind: 'provider-planned' | 'our-planned';
  readonly capabilities: {
    /** Can the channel guarantee a car/van-capable courier? */
    readonly vehicleGuarantee: boolean;
    /**
     * Can the channel VERIFY the customer's age at the door
     * (docs/handover-verification.md)? HARD requirement: the resolver
     * excludes non-capable channels for age-restricted orders.
     */
    readonly ageCheck: boolean;
    /**
     * Does the channel verify OUR delivery pin at handover? Soft/
     * opportunistic — never gates resolution; channels without it simply
     * deliver unverified (outcome 'not-checked').
     */
    readonly deliveryPin: boolean;
  };
  /** Present only for provider-planned channels. */
  readonly adapter?: TransportProviderAdapter;
}

export interface ProviderRegistry {
  get(code: string): ProviderChannel | null;
  codes(): readonly string[];
}

export function createProviderRegistry(channels: readonly ProviderChannel[]): ProviderRegistry {
  const byCode = new Map(channels.map((c) => [c.code, c]));
  return {
    get: (code) => byCode.get(code) ?? null,
    codes: () => [...byCode.keys()],
  };
}

/** Our execution app's channel — drivers have vehicles by definition. */
export const OWN_CHANNEL: ProviderChannel = {
  code: 'own',
  kind: 'our-planned',
  capabilities: { vehicleGuarantee: true, ageCheck: true, deliveryPin: true },
};

/**
 * EPOD (Integral) driver channel — same marketplace, proxied claim surface.
 * Their app has no age-verification or our-pin flow (until their side
 * grows one), so age-restricted orders never resolve to it.
 */
export const EPOD_CHANNEL: ProviderChannel = {
  code: 'epod',
  kind: 'our-planned',
  capabilities: { vehicleGuarantee: true, ageCheck: false, deliveryPin: false },
};
