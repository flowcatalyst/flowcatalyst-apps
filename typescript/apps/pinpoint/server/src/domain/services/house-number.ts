/**
 * Does an address name a house (so a geocode is only "house-level" when it
 * found one)? Used by the geocoder fallback (ask Google when Photon misses the
 * house) and by auto-approval.
 */
import type { NormalizedAddress } from './address-normalizer.js';

/** A leading number token: `16`, `16a`, `16-18`. */
const HOUSE_NUMBER = /^\d+[a-z]?\b/i;

/** Structured input wants a house: a house number, or a road like "16 Curvy". */
export function wantsHouse(address: NormalizedAddress): boolean {
  if (address.houseNumber?.trim()) return true;
  return HOUSE_NUMBER.test(address.road?.trim() ?? '');
}

/** Free text wants a house when its first segment starts with a number. */
export function lineWantsHouse(line: string): boolean {
  const first = line.split(',')[0]?.trim() ?? '';
  return HOUSE_NUMBER.test(first);
}
