/**
 * How long pinpoint may keep coordinates from each geocoder. Photon (our own
 * OSM index) and operator-confirmed coordinates are ours to keep. Google Maps'
 * terms allow caching its coordinates for at most 30 consecutive days, after
 * which they must be refreshed (a new request) or deleted — so a Google-sourced
 * master carries an expiry, and the daily `pinpoint-refresh-cached-geocodes`
 * job renews or drops it.
 */
import type { GeocodeSource } from './geocoder.js';

/** Google Maps Platform terms: lat/lng may be cached for up to 30 days. */
export const GOOGLE_MAPS_MAX_CACHE_DAYS = 30;

/** Refresh this many days before expiry, so a failing day or two still lands in time. */
export const REFRESH_MARGIN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When coordinates from `source` must be refreshed or dropped; null = keep. */
export function geocodeExpiry(source: GeocodeSource, now: Date, cacheDays: number): Date | null {
  if (source !== 'GOOGLE_MAPS') return null;
  const days = Math.min(Math.max(1, cacheDays), GOOGLE_MAPS_MAX_CACHE_DAYS);
  return new Date(now.getTime() + days * DAY_MS);
}

/** Masters expiring before this instant are due for a refresh. */
export function refreshCutoff(now: Date): Date {
  return new Date(now.getTime() + REFRESH_MARGIN_DAYS * DAY_MS);
}
