import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ProviderDelivery } from '../provider-port.js';
import { normalizeUberStatus } from './adapter.js';
import type { UberWebhookEvent } from './types.js';

/**
 * Uber Direct webhook handling. Configured in the Direct dashboard
 * (Developer → Webhooks; the signing key lives there too — per environment,
 * test creds sign test events).
 *
 * Signature: `x-uber-signature` = lowercase-hex HMAC-SHA256 of the RAW
 * request body with the signing key. (delivery/courier events also carry
 * the legacy `x-postmates-signature`.) The route must therefore capture the
 * raw body BEFORE JSON parsing. Uber retries on 5xx/timeout: 10s, then
 * 30/60/120s backoff, max 3 attempts — respond 2xx fast, process async.
 */
export function verifyUberSignature(
  rawBody: string | Buffer,
  signature: string,
  signingKey: string,
): boolean {
  const expected = createHmac('sha256', signingKey).update(rawBody).digest('hex');
  const provided = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

export interface UberStatusUpdate {
  readonly kind: UberWebhookEvent['kind'];
  readonly providerRef: string;
  readonly delivery: ProviderDelivery;
  readonly courierLocation?: { readonly lat: number; readonly lng: number } | undefined;
  readonly liveMode: boolean;
}

/** Normalize a verified webhook event for the transport context. */
export function toStatusUpdate(event: UberWebhookEvent): UberStatusUpdate {
  return {
    kind: event.kind,
    providerRef: event.delivery_id,
    delivery: {
      providerRef: event.delivery_id,
      status: normalizeUberStatus(event.data.status),
      trackingUrl: event.data.tracking_url,
      feeCents: event.data.fee,
      currency: event.data.currency,
      liveMode: event.live_mode,
      ...(event.data.courier
        ? {
            courier: {
              name: event.data.courier.name,
              vehicleType: event.data.courier.vehicle_type,
              phone: event.data.courier.phone_number,
              location: event.data.courier.location,
            },
          }
        : {}),
    },
    courierLocation: event.location,
    liveMode: event.live_mode,
  };
}
