import type { ResolvedTransportStoreSettings, TransportProviderEntry } from '@fulfil-go/shared';
import type { ProviderRegistry } from './adapter-registry.js';

/**
 * Provider resolution (docs/transport-context.md, locked 2026-07-11):
 * candidates = store's allowed providers (ordered) → filter by registry
 * membership, COVERAGE (dropoff within the entry's radius from the store —
 * the v1 coverage oracle; the seam swaps to polygon truth when pinpoint
 * layers land) and CAPABILITY (requiresVehicle vs vehicleGuarantee) → rank
 * with the store default first. Selection happens at transport-order
 * creation; the ranked remainder is the fallback chain.
 *
 * Coverage v1 is a great-circle radius check computed here (haversine) —
 * both endpoints' coordinates are already in hand, so no spatial query is
 * needed until polygon-level truth arrives.
 */
export interface ResolveProvidersInput {
  readonly settings: ResolvedTransportStoreSettings;
  readonly registry: ProviderRegistry;
  readonly requiresVehicle: boolean;
  /** Store coordinates (registry columns) — null when never synced. */
  readonly storeGeo: { lat: number; lng: number } | null;
  /** Dropoff coordinates — null for destinations without geo. */
  readonly dropoffGeo: { lat: number; lng: number } | null;
}

export interface ResolvedProviders {
  /** Ranked provider codes; [0] is the selection. Empty = nothing serviceable. */
  readonly candidates: readonly string[];
  /** Codes filtered out, with why — for the activity log. */
  readonly rejected: readonly { code: string; reason: string }[];
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function isCovered(
  entry: TransportProviderEntry,
  storeGeo: ResolveProvidersInput['storeGeo'],
  dropoffGeo: ResolveProvidersInput['dropoffGeo'],
): { covered: boolean; reason?: string } {
  if (entry.serviceRadiusKm === undefined) return { covered: true };
  if (!storeGeo || !dropoffGeo) {
    // A radius is configured but we can't measure — fail CLOSED so a
    // missing geo surfaces as "not serviceable" instead of a silent
    // out-of-area booking.
    return { covered: false, reason: 'coverage radius set but store/dropoff geo missing' };
  }
  const km = haversineKm(storeGeo, dropoffGeo);
  return km <= entry.serviceRadiusKm
    ? { covered: true }
    : { covered: false, reason: `dropoff ${km.toFixed(1)}km from store exceeds ${entry.serviceRadiusKm}km radius` };
}

export function resolveProviders(input: ResolveProvidersInput): ResolvedProviders {
  const { settings, registry } = input;
  const rejected: { code: string; reason: string }[] = [];
  const candidates: string[] = [];

  for (const entry of settings.transportProviders) {
    const channel = registry.get(entry.code);
    if (!channel) {
      rejected.push({ code: entry.code, reason: 'not a registered provider' });
      continue;
    }
    if (input.requiresVehicle && !channel.capabilities.vehicleGuarantee) {
      rejected.push({ code: entry.code, reason: 'cannot guarantee a vehicle' });
      continue;
    }
    const coverage = isCovered(entry, input.storeGeo, input.dropoffGeo);
    if (!coverage.covered) {
      rejected.push({ code: entry.code, reason: coverage.reason ?? 'out of coverage' });
      continue;
    }
    candidates.push(entry.code);
  }

  // Store default first, remaining allowed order preserved.
  const preferred = settings.defaultTransportProvider;
  if (preferred && candidates.includes(preferred)) {
    candidates.splice(candidates.indexOf(preferred), 1);
    candidates.unshift(preferred);
  }

  return { candidates, rejected };
}
