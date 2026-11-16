/**
 * When does a delivery capture disagree with a location's coordinates? GPS on
 * a phone is good to a few metres in the open and tens of metres between
 * buildings, so a fixed threshold would either flag noise or miss real
 * errors. A capture disagrees when it lands further than
 * max(50 m, 2 × its reported accuracy) from the location — the 50 m floor
 * covers a large property's gate vs. its centroid.
 */

/** Distance below which a capture never disagrees, in metres. */
export const CAPTURE_TOLERANCE_FLOOR_M = 50;

export function captureToleranceM(accuracyM: number | null): number {
  return Math.max(CAPTURE_TOLERANCE_FLOOR_M, 2 * (accuracyM ?? 0));
}

export function captureDisagrees(distanceM: number, accuracyM: number | null): boolean {
  return distanceM > captureToleranceM(accuracyM);
}

/** Great-circle distance in metres (haversine). */
export function distanceM(
  a: { readonly latitude: number; readonly longitude: number },
  b: { readonly latitude: number; readonly longitude: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
