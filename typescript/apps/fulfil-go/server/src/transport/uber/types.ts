/**
 * Uber Direct (DaaS) wire types — hand-written subset of the official
 * OpenAPI (github.com/uber/uber-direct-sdk, Oct 2024) + the 2025–26
 * changelog deltas. Field names are EXACT wire names; do not rename.
 *
 * Conventions to remember (docs verified 2026-07-11):
 * - addresses are JSON-STRINGIFIED strings, not nested objects;
 * - all money is integer CENTS; weights GRAMS; dimensions CENTIMETERS;
 * - datetimes are RFC 3339 UTC (`Z`); phones must match ^\+[0-9]+$;
 * - quotes expire after 15 minutes and are single-use.
 */

/** The stringified-JSON address payload (before JSON.stringify). */
export interface UberAddress {
  street_address: string[];
  city: string;
  state?: string;
  zip_code?: string;
  country: string;
}

export interface UberQuoteRequest {
  pickup_address: string;
  dropoff_address: string;
  pickup_latitude?: number;
  pickup_longitude?: number;
  dropoff_latitude?: number;
  dropoff_longitude?: number;
  pickup_ready_dt?: string;
  pickup_deadline_dt?: string;
  dropoff_ready_dt?: string;
  dropoff_deadline_dt?: string;
  pickup_phone_number?: string;
  dropoff_phone_number?: string;
  manifest_total_value?: number;
  external_store_id?: string;
}

export interface UberQuoteResponse {
  kind: 'delivery_quote';
  id: string; // dqt_…
  created: string;
  expires: string;
  fee: number;
  currency?: string; // deprecated lowercase
  currency_type: string; // uppercase ISO — use this
  dropoff_eta?: string;
  duration?: number; // minutes to dropoff
  pickup_duration?: number; // minutes until courier at pickup
  dropoff_deadline?: string;
}

export type UberManifestSize = 'small' | 'medium' | 'large' | 'xlarge';

export interface UberManifestItem {
  name: string;
  quantity: number;
  size?: UberManifestSize;
  dimensions?: { length: number; height: number; depth: number }; // cm
  weight?: number; // grams; required when dimensions present
  price?: number; // cents
  must_be_upright?: boolean;
}

export interface UberRoboCourierSpecification {
  mode?: 'auto';
  enroute_for_pickup_at?: string;
  pickup_imminent_at?: string;
  pickup_at?: string;
  dropoff_imminent_at?: string;
  dropoff_at?: string;
  cancel_reason?:
    | 'cannot_access_customer_location'
    | 'cannot_find_customer_address'
    | 'customer_rejected_order'
    | 'customer_unavailable';
}

export interface UberCreateDeliveryRequest extends UberQuoteRequest {
  quote_id?: string;
  pickup_name: string;
  pickup_business_name?: string;
  pickup_notes?: string;
  dropoff_name: string;
  dropoff_business_name?: string;
  dropoff_notes?: string;
  manifest_items: UberManifestItem[];
  manifest_reference?: string;
  tip?: number;
  idempotency_key?: string;
  external_id?: string;
  undeliverable_action?: 'leave_at_door' | 'return' | 'discard';
  deliverable_action?: 'deliverable_action_meet_at_door' | 'deliverable_action_leave_at_door';
  /** Uber Direct proof-of-delivery: the courier verifies the recipient. */
  dropoff_verification?: {
    identification?: { min_age: number };
  };
  test_specifications?: { robo_courier_specification: UberRoboCourierSpecification };
}

export type UberDeliveryStatus =
  | 'pending'
  | 'pickup'
  | 'pickup_complete'
  | 'dropoff'
  | 'delivered'
  | 'canceled'
  | 'returned';

export interface UberCourierInfo {
  name?: string;
  vehicle_type?: string; // bicycle|car|van|truck|scooter|motorcycle|walker
  phone_number?: string; // masked
  location?: { lat: number; lng: number };
  img_href?: string;
  vehicle_license_plate?: string;
}

export interface UberDeliveryResponse {
  kind: 'delivery';
  id: string; // del_…
  quote_id?: string;
  status: UberDeliveryStatus;
  complete: boolean;
  courier: UberCourierInfo | null;
  courier_imminent?: boolean;
  created?: string;
  updated?: string;
  currency?: string;
  fee?: number; // cents, includes tip
  tip?: number;
  tracking_url?: string;
  undeliverable_action?: string; // outcome, not echo: ""|left_at_door|returned
  undeliverable_reason?: string;
  external_id?: string;
  live_mode?: boolean;
  uuid?: string;
}

export interface UberErrorBody {
  kind: 'error';
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/** event.delivery_status / event.courier_update webhook envelope. */
export interface UberWebhookEvent {
  id: string;
  kind: 'event.delivery_status' | 'event.courier_update' | 'event.refund_request';
  status?: UberDeliveryStatus;
  created: string;
  customer_id: string;
  delivery_id: string; // del_… (ret_… for return legs)
  live_mode: boolean;
  location?: { lat: number; lng: number }; // courier_update only
  data: UberDeliveryResponse;
}
