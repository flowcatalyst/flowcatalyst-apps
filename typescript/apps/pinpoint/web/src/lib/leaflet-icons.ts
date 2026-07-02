import L from 'leaflet';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

/**
 * Fix Leaflet's default marker icons under Vite.
 *
 * Leaflet resolves its built-in marker images (`marker-icon.png`,
 * `marker-icon-2x.png`, `marker-shadow.png`) from a URL computed RELATIVE to
 * the current page. Under our bundler + SPA routing that resolves to paths like
 * `/master-locations/marker-shadow.png` — which 404 (or hit the
 * `/master-locations/:id` API and return "not found"), so markers render blank.
 *
 * Importing the images routes them through Vite (fingerprinted into /assets),
 * and pointing `L.Icon.Default` at those real URLs makes every default marker —
 * across PpMapView, PpLayerEditor, and LayerMapPage — resolve correctly. Import
 * this module once for its side effect (see main.ts) before any map renders.
 */
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });
