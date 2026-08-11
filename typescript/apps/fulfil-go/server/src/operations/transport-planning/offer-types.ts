import type { TransportStop } from '../../transport/provider-port.js';

/**
 * The offer/claim marketplace's wire shapes — ONE surface for both
 * consumers: EPOD's Integral claim proxy (`FulfilGoClaimClient` maps
 * `groupId`/`partReferences`/`transportOrderRefs`/`depotNames`/`expiresAt`
 * into their driver app's shapes) and our execution app (which also gets
 * the stop detail).
 */
export interface OfferStopDto {
  readonly orderId: string;
  readonly shortId: string;
  readonly destination: TransportStop;
  readonly legKm: number | null;
  readonly legMinutes: number | null;
}

export interface TransportOfferDto {
  readonly groupId: string;
  readonly depotNames: readonly string[];
  readonly partReferences: readonly string[];
  readonly transportOrderRefs: readonly string[];
  readonly expiresAt: string;
  /** Hold remaining at response time — the app's skew-immune countdown source. */
  readonly expiresInSeconds: number;
  readonly originRef: string;
  readonly stops: readonly OfferStopDto[];
  readonly routeKm: number | null;
  readonly routeMinutes: number | null;
}

export interface ComposeOfferResult {
  readonly offers: readonly TransportOfferDto[];
  /** Why the offer list is empty (anchor unavailable, no work, …). */
  readonly reason?: string;
}

export interface ClaimTripResult {
  readonly tripReference: string;
  readonly orderReferences: readonly string[];
}
