/**
 * Leaflet + OpenStreetMap setup shared by the map pages. Import for its side
 * effects (CSS + default-marker icon fix) before creating any map.
 *
 * Icon fix (same story as pinpoint's lib/leaflet-icons.ts): Leaflet resolves
 * its marker PNGs relative to the current page URL, which 404s under Vite +
 * SPA routing. Importing the images routes them through the bundler.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

/** OSM's free raster tiles — attribution is a hard requirement of the tile policy. */
export function osmTileLayer(): L.TileLayer {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
}

export { L };
