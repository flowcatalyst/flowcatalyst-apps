import type { PackageSize } from '@fulfil-go/shared';
import type {
  ProviderDelivery,
  TransportBookingRequest,
  TransportOrderStatus,
  TransportProviderAdapter,
  TransportQuoteOutcome,
  TransportQuoteRequest,
  TransportStop,
  TransportWindow,
} from '../provider-port.js';
import {
  UberApiError,
  createUberClient,
  type UberClient,
  type UberClientConfig,
} from './client.js';
import type {
  UberAddress,
  UberCreateDeliveryRequest,
  UberDeliveryResponse,
  UberDeliveryStatus,
  UberManifestItem,
  UberManifestSize,
  UberQuoteRequest,
  UberRoboCourierSpecification,
} from './types.js';

/**
 * Uber Direct adapter for the transport provider port.
 *
 * House rules encoded here (Andrew, 2026-07-11):
 * - `pickup_ready_dt` is ALWAYS the slot start, never earlier — quoting a
 *   pickup before the store's hours of operation gets rejected. If the slot
 *   has already started, clamp to now (Uber rejects past ready times).
 * - Manifest sizing comes from the CAPTURED BAG SIZES (pick actuals), not
 *   recomputed volumetrics — Uber falls back to package size anyway.
 * - `requiresCarOrLarger` (picker-supplied): Uber has NO vehicle-guarantee
 *   field (courier vehicle_type is informational), so the adapter declares
 *   `capabilities.vehicleGuarantee: false` — the resolver decides whether
 *   best-effort is acceptable — and nudges matching by forcing at least one
 *   `xlarge` manifest item.
 */
export interface UberAdapterConfig extends UberClientConfig {
  /** Robo Courier simulation — TEST CREDENTIALS ONLY (live_mode:false).
   *  `{ mode: 'auto' }` walks the full lifecycle at 30s intervals. */
  readonly testSpecifications?: UberRoboCourierSpecification | undefined;
  /** Client policy: hide goods identity from the courier (theft-risk
   *  concern — first client). Manifest item names become the package
   *  ref/barcode instead of the descriptive name. Belongs in the
   *  per-client/store provider config blob once transport config lands. */
  readonly obfuscateManifest?: boolean | undefined;
}

const MINUTE_MS = 60_000;

/** Slot start, never earlier; clamped to `now` when the slot already began. */
export function pickupReadyAt(window: TransportWindow, now: Date): Date {
  return window.slotStart.getTime() > now.getTime() ? window.slotStart : now;
}

/** Slot end, floored to Uber's minimums (ready+10min AND now+20min). */
export function pickupDeadlineAt(window: TransportWindow, ready: Date, now: Date): Date {
  return new Date(
    Math.max(
      window.slotEnd.getTime(),
      ready.getTime() + 10 * MINUTE_MS,
      now.getTime() + 20 * MINUTE_MS,
    ),
  );
}

/** Our address → Uber's stringified-JSON address (their wire format). */
export function toUberAddress(stop: TransportStop): string {
  const streetLines = [stop.address.line1, stop.address.line2, stop.address.suburb].filter(
    (line): line is string => Boolean(line),
  );
  const address: UberAddress = {
    street_address: streetLines,
    city: stop.address.city,
    ...(stop.address.region ? { state: stop.address.region } : {}),
    ...(stop.address.postalCode ? { zip_code: stop.address.postalCode } : {}),
    country: stop.address.countryCode,
  };
  return JSON.stringify(address);
}

/** Uber requires ^\+[0-9]+$ — strip formatting, demand a resolvable E.164. */
export function toUberPhone(phone: string): string {
  const digits = phone.replace(/[^0-9+]/g, '');
  const normalized = digits.startsWith('+')
    ? `+${digits.slice(1).replace(/\+/g, '')}`
    : `+${digits}`;
  if (!/^\+[0-9]{6,15}$/.test(normalized)) {
    throw new Error(`phone '${phone}' cannot be normalized to E.164 for Uber`);
  }
  return normalized;
}

/** Captured bag size → Uber manifest size. */
export const BAG_SIZE_TO_UBER: Record<PackageSize, UberManifestSize> = {
  XS: 'small',
  S: 'small',
  M: 'medium',
  L: 'large',
  XL: 'xlarge',
};

const UBER_SIZE_RANK: Record<UberManifestSize, number> = {
  small: 0,
  medium: 1,
  large: 2,
  xlarge: 3,
};

export function toManifestItems(
  parcels: TransportBookingRequest['parcels'],
  requiresCarOrLarger: boolean,
  obfuscate = false,
): UberManifestItem[] {
  const items: UberManifestItem[] = parcels.map((parcel) => ({
    // Obfuscated: the courier sees only the package ref/barcode, never what
    // is inside (per-client policy — theft-risk concern).
    name: obfuscate ? parcel.ref : parcel.description,
    quantity: 1,
    size: parcel.size ? BAG_SIZE_TO_UBER[parcel.size] : 'small',
  }));
  if (requiresCarOrLarger && items.length > 0) {
    // Best-effort vehicle nudge: promote the largest item to xlarge.
    const largest = items.reduce((max, item) =>
      UBER_SIZE_RANK[item.size ?? 'small'] > UBER_SIZE_RANK[max.size ?? 'small'] ? item : max,
    );
    largest.size = 'xlarge';
  }
  return items;
}

export function normalizeUberStatus(status: UberDeliveryStatus): TransportOrderStatus {
  switch (status) {
    case 'pending':
      return 'booked';
    case 'pickup':
      return 'assigned';
    case 'pickup_complete':
    case 'dropoff':
      return 'collected';
    case 'delivered':
      return 'delivered';
    case 'canceled':
      return 'cancelled';
    case 'returned':
      // Goods came back to the store — the delivery failed.
      return 'failed';
  }
}

/** Quote-rejection classes drive the resolver's fallback chain. */
function classifyQuoteError(error: UberApiError): TransportQuoteOutcome {
  const reason =
    error.code === 'address_undeliverable' ||
    error.code === 'address_undeliverable_limited_couriers' ||
    error.code === 'unknown_location'
      ? 'not_serviceable'
      : error.code.includes('pickup_') ||
          error.code.includes('dropoff_') ||
          error.code === 'pickup_window_too_small'
        ? 'window_invalid'
        : error.code === 'couriers_busy' ||
            error.code === 'robo_couriers_busy' ||
            error.code === 'customer_limited'
          ? 'capacity'
          : 'other';
  return { accepted: false, reason, providerCode: error.code, message: error.message };
}

function toProviderDelivery(res: UberDeliveryResponse): ProviderDelivery {
  return {
    providerRef: res.id,
    status: normalizeUberStatus(res.status),
    trackingUrl: res.tracking_url,
    feeCents: res.fee,
    currency: res.currency,
    liveMode: res.live_mode,
    ...(res.courier
      ? {
          courier: {
            name: res.courier.name,
            vehicleType: res.courier.vehicle_type,
            phone: res.courier.phone_number,
            location: res.courier.location,
          },
        }
      : {}),
  };
}

export function createUberAdapter(
  config: UberAdapterConfig,
  client: UberClient = createUberClient(config),
  clock: () => Date = () => new Date(),
): TransportProviderAdapter {
  function baseRequest(request: TransportQuoteRequest): UberQuoteRequest {
    const now = clock();
    const ready = pickupReadyAt(request.window, now);
    const deadline = pickupDeadlineAt(request.window, ready, now);
    return {
      pickup_address: toUberAddress(request.origin),
      dropoff_address: toUberAddress(request.destination),
      ...(request.origin.geo
        ? { pickup_latitude: request.origin.geo.lat, pickup_longitude: request.origin.geo.lng }
        : {}),
      ...(request.destination.geo
        ? {
            dropoff_latitude: request.destination.geo.lat,
            dropoff_longitude: request.destination.geo.lng,
          }
        : {}),
      pickup_ready_dt: ready.toISOString(),
      pickup_deadline_dt: deadline.toISOString(),
      pickup_phone_number: toUberPhone(request.origin.phone),
      dropoff_phone_number: toUberPhone(request.destination.phone),
      ...(request.declaredValueCents !== undefined
        ? { manifest_total_value: request.declaredValueCents }
        : {}),
      // Must match between quote and delivery when used at all.
      ...(request.externalStoreId ? { external_store_id: request.externalStoreId } : {}),
    };
  }

  return {
    code: 'uber',
    // ageCheck rides Uber Direct's dropoff_verification.identification;
    // deliveryPin is false — Uber's pincode feature generates THEIR code,
    // not ours (docs/handover-verification.md).
    capabilities: { vehicleGuarantee: false, ageCheck: true, deliveryPin: false },

    async quote(request): Promise<TransportQuoteOutcome> {
      try {
        const res = await client.createQuote(baseRequest(request));
        return {
          accepted: true,
          providerQuoteRef: res.id,
          feeCents: res.fee,
          currency: res.currency_type,
          expiresAt: new Date(res.expires),
          ...(res.dropoff_eta ? { etaDropoff: new Date(res.dropoff_eta) } : {}),
          ...(res.pickup_duration !== undefined
            ? { pickupDurationMinutes: res.pickup_duration }
            : {}),
        };
      } catch (error) {
        // Any Uber-reported failure (incl. 503 couriers_busy) is a quote
        // rejection the resolver can act on; only transport-level faults throw.
        if (error instanceof UberApiError) return classifyQuoteError(error);
        throw error;
      }
    },

    async createDelivery(request): Promise<ProviderDelivery> {
      const body: UberCreateDeliveryRequest = {
        ...baseRequest(request),
        ...(request.providerQuoteRef ? { quote_id: request.providerQuoteRef } : {}),
        pickup_name: request.origin.name,
        pickup_business_name: request.origin.name,
        ...(request.origin.instructions ? { pickup_notes: request.origin.instructions } : {}),
        dropoff_name: request.destination.name,
        ...(request.destination.instructions
          ? { dropoff_notes: request.destination.instructions }
          : {}),
        manifest_items: toManifestItems(
          request.parcels,
          request.requiresCarOrLarger,
          config.obfuscateManifest ?? false,
        ),
        manifest_reference: request.externalRef,
        external_id: request.externalRef,
        idempotency_key: request.idempotencyKey,
        undeliverable_action: 'return',
        ...(request.verification?.minAge !== undefined
          ? { dropoff_verification: { identification: { min_age: request.verification.minAge } } }
          : {}),
        ...(config.testSpecifications
          ? { test_specifications: { robo_courier_specification: config.testSpecifications } }
          : {}),
      };
      try {
        return toProviderDelivery(await client.createDelivery(body));
      } catch (error) {
        // Uber's own idempotency: a duplicate within the ~60min window 409s
        // with the existing delivery id in metadata — fetch it, don't fail.
        if (
          error instanceof UberApiError &&
          error.status === 409 &&
          error.code === 'duplicate_delivery' &&
          typeof error.metadata?.['delivery_id'] === 'string'
        ) {
          return toProviderDelivery(
            await client.getDelivery(error.metadata['delivery_id'] as string),
          );
        }
        throw error;
      }
    },

    async getDelivery(providerRef): Promise<ProviderDelivery> {
      return toProviderDelivery(await client.getDelivery(providerRef));
    },

    async cancelDelivery(providerRef): Promise<ProviderDelivery> {
      return toProviderDelivery(await client.cancelDelivery(providerRef));
    },
  };
}
