import { describe, expect, it } from 'vitest';
import { polygonCentroid } from './polygon-centroid.js';

describe('polygonCentroid', () => {
  it('averages the outer ring, skipping the closing vertex', () => {
    // Unit square, closed ring — centroid (0.5, 0.5).
    const geojson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    });
    expect(polygonCentroid(geojson)).toEqual({ lat: 0.5, lon: 0.5 });
  });

  it('lands inside the Johannesburg example polygon', () => {
    const geojson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [28.040414, -26.202018],
          [28.040671, -26.205445],
          [28.042302, -26.208773],
          [28.044147, -26.205269],
          [28.044362, -26.202497],
          [28.04256, -26.20346],
          [28.042388, -26.20165],
          [28.040414, -26.201996],
          [28.040414, -26.201996],
          [28.040414, -26.202018],
        ],
      ],
    });
    const center = polygonCentroid(geojson);
    expect(center).not.toBeNull();
    expect(center!.lat).toBeGreaterThan(-26.21);
    expect(center!.lat).toBeLessThan(-26.2);
    expect(center!.lon).toBeGreaterThan(28.04);
    expect(center!.lon).toBeLessThan(28.045);
  });

  it('handles MultiPolygon outer rings', () => {
    const geojson = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      ],
    });
    expect(polygonCentroid(geojson)).toEqual({ lat: 1, lon: 1 });
  });

  it('returns null for garbage, non-polygons, and empty rings', () => {
    expect(polygonCentroid('not json')).toBeNull();
    expect(polygonCentroid(JSON.stringify({ type: 'Point', coordinates: [1, 2] }))).toBeNull();
    expect(polygonCentroid(JSON.stringify({ type: 'Polygon', coordinates: [] }))).toBeNull();
    expect(
      polygonCentroid(JSON.stringify({ type: 'Polygon', coordinates: [[['a', 'b']]] })),
    ).toBeNull();
  });
});
