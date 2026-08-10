/**
 * Display centroid for a feature's polygon — vertex average of the outer
 * ring(s), good enough for map pins and grid coordinates (NOT an area
 * centroid; concave shapes may land slightly off-center, which is fine for
 * display). Returns null on anything unparseable — callers treat that as
 * "no derivable center".
 */
type Position = [number, number];

export function polygonCentroid(polygonGeojson: string): { lat: number; lon: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(polygonGeojson);
  } catch {
    return null;
  }
  const geometry = parsed as { type?: string; coordinates?: unknown };
  // Outer ring(s) only — holes would bias the average outward.
  let rings: Position[][];
  if (geometry.type === 'Polygon') {
    rings = [(geometry.coordinates as Position[][])?.[0] ?? []];
  } else if (geometry.type === 'MultiPolygon') {
    rings = ((geometry.coordinates as Position[][][]) ?? []).map((poly) => poly?.[0] ?? []);
  } else {
    return null;
  }

  let sumLat = 0;
  let sumLon = 0;
  let count = 0;
  for (const ring of rings) {
    // GeoJSON rings repeat the first vertex at the end — skip the closer.
    const closed =
      ring.length > 1 &&
      ring[0]?.[0] === ring[ring.length - 1]?.[0] &&
      ring[0]?.[1] === ring[ring.length - 1]?.[1];
    const vertices = closed ? ring.slice(0, -1) : ring;
    for (const position of vertices) {
      if (
        !Array.isArray(position) ||
        typeof position[0] !== 'number' ||
        typeof position[1] !== 'number'
      ) {
        return null;
      }
      sumLon += position[0];
      sumLat += position[1];
      count += 1;
    }
  }
  if (count === 0) return null;
  return { lat: sumLat / count, lon: sumLon / count };
}
