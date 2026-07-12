import type { PackageSize } from '@fulfil-go/shared';

/**
 * Transport provider port — the seam every execution system implements
 * ('own', 'uber', 'inmotion', …). See docs/transport-context.md: the
 * TransportOrder aggregate speaks these normalized shapes; provider-side
 * nouns (trip, shipment, delivery) stay behind the adapter.
 *
 * Status machine (normalized across providers):
 *   requested → booked → assigned → collected → delivered | failed | cancelled
 */
export type TransportOrderStatus =
  | 'requested'
  | 'booked'
  | 'assigned'
  | 'collected'
  | 'delivered'
  | 'failed'
  | 'cancelled';

/** A stop (origin store or destination) in provider-neutral terms. */
export interface TransportStop {
  readonly name: string;
  /** Same shape as the fulfilment's captured location address. */
  readonly address: {
    readonly line1: string;
    readonly line2?: string | undefined;
    readonly suburb?: string | undefined;
    readonly city: string;
    readonly region?: string | undefined;
    readonly postalCode?: string | undefined;
    readonly countryCode: string;
  };
  readonly geo?: { readonly lat: number; readonly lng: number } | undefined;
  readonly phone: string;
  readonly instructions?: string | undefined;
}

export interface TransportWindow {
  readonly slotStart: Date;
  readonly slotEnd: Date;
}

/** A packed unit from the pick ACTUALS (bag sizes drive provider sizing). */
export interface TransportParcel {
  readonly ref: string;
  readonly kind: 'bag' | 'loose';
  readonly size: PackageSize | null;
  readonly temperature: string;
  readonly description: string;
}

export interface TransportQuoteRequest {
  readonly origin: TransportStop;
  readonly destination: TransportStop;
  readonly window: TransportWindow;
  /** Declared goods value in CENTS (provider convention). */
  readonly declaredValueCents?: number | undefined;
  /** Provider-side store identifier, when the provider config carries one. */
  readonly externalStoreId?: string | undefined;
}

export type TransportQuoteOutcome =
  | {
      readonly accepted: true;
      readonly providerQuoteRef: string;
      readonly feeCents: number;
      readonly currency: string;
      readonly expiresAt: Date;
      readonly etaDropoff?: Date | undefined;
      readonly pickupDurationMinutes?: number | undefined;
    }
  | {
      readonly accepted: false;
      /** Normalized rejection class — drives resolver fallback. */
      readonly reason: 'not_serviceable' | 'window_invalid' | 'capacity' | 'other';
      readonly providerCode: string;
      readonly message: string;
    };

export interface TransportBookingRequest extends TransportQuoteRequest {
  /** Quote linkage when the provider supports price lock. */
  readonly providerQuoteRef?: string | undefined;
  readonly parcels: readonly TransportParcel[];
  /** Picker-supplied signal (pick completion question). */
  readonly requiresVehicle: boolean;
  /** Our references — idempotency + provider-visible correlation. */
  readonly externalRef: string;
  readonly idempotencyKey: string;
}

export interface ProviderCourier {
  readonly name?: string | undefined;
  readonly vehicleType?: string | undefined;
  readonly phone?: string | undefined;
  readonly location?: { readonly lat: number; readonly lng: number } | undefined;
}

export interface ProviderDelivery {
  readonly providerRef: string;
  readonly status: TransportOrderStatus;
  readonly trackingUrl?: string | undefined;
  readonly feeCents?: number | undefined;
  readonly currency?: string | undefined;
  readonly courier?: ProviderCourier | undefined;
  /** false = provider test environment (e.g. Uber live_mode: false). */
  readonly liveMode?: boolean | undefined;
}

export interface TransportProviderAdapter {
  readonly code: string;
  readonly capabilities: {
    /** Can the provider GUARANTEE a car/van-capable courier? If false, the
     *  resolver must not pick this provider for requiresVehicle orders
     *  unless policy accepts best-effort sizing nudges. */
    readonly vehicleGuarantee: boolean;
  };
  quote(request: TransportQuoteRequest): Promise<TransportQuoteOutcome>;
  createDelivery(request: TransportBookingRequest): Promise<ProviderDelivery>;
  getDelivery(providerRef: string): Promise<ProviderDelivery>;
  cancelDelivery(providerRef: string): Promise<ProviderDelivery>;
}
