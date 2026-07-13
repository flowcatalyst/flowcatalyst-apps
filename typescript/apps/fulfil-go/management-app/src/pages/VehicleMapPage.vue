<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, clientId } from '../context.js';
import PageHeader from '../components/PageHeader.vue';

/**
 * Live vehicle map (docs/transport-context.md "Positions + map"): every
 * vehicle across execution systems — our app's drivers ('own', from the
 * Transistorsoft telemetry), Uber couriers (webhook courier_update), EPOD
 * drivers when that channel lands. Colour = execution system; faded =
 * inactive (no fix in 10 min, server-computed). 10s polling; the ops SSE
 * channel can nudge this later.
 *
 * Tiles: VITE_MAP_STYLE_URL (the router service's tile stack once exposed)
 * — falls back to the public MapLibre demo style for dev.
 */
interface VehiclePosition {
  executionSystem: string;
  vehicleRef: string;
  label: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
  active: boolean;
  tripRef: string | null;
}

const SYSTEM_COLORS: Record<string, string> = {
  own: '#0967d2', // fc-accent brand blue — our execution app
  epod: '#7c3aed', // violet — Integral EPOD drivers
  uber: '#111827', // near-black — Uber couriers
};
const FALLBACK_COLOR = '#64748b';

const STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL ?? 'https://demotiles.maplibre.org/style.json';
/** Centre of SA — sensible first view until positions arrive. */
const DEFAULT_CENTER: [number, number] = [25.0, -29.0];

const mapEl = ref<HTMLDivElement | null>(null);
const vehicles = ref<VehiclePosition[]>([]);
const error = ref<string | null>(null);
const lastRefresh = ref<Date | null>(null);

let map: maplibregl.Map | null = null;
const markers = new Map<string, maplibregl.Marker>();
let timer: ReturnType<typeof setInterval> | null = null;
let fitted = false;

function markerKey(v: VehiclePosition): string {
  return `${v.executionSystem}:${v.vehicleRef}`;
}

function popupHtml(v: VehiclePosition): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `
    <div style="font: 12px Inter, sans-serif; min-width: 180px">
      <strong>${esc(v.label ?? v.vehicleRef)}</strong><br/>
      <span style="color:#64748b">System:</span> ${esc(v.executionSystem)}<br/>
      <span style="color:#64748b">Status:</span> ${v.active ? 'active' : 'inactive'}<br/>
      <span style="color:#64748b">Last fix:</span> ${new Date(v.recordedAt).toLocaleTimeString()}<br/>
      ${v.tripRef ? `<span style="color:#64748b">Trip:</span> <code>${esc(v.tripRef)}</code><br/>` : ''}
      <code style="color:#94a3b8">${esc(v.vehicleRef)}</code>
    </div>`;
}

function renderMarkers(): void {
  if (!map) return;
  const seen = new Set<string>();
  for (const v of vehicles.value) {
    const key = markerKey(v);
    seen.add(key);
    const color = SYSTEM_COLORS[v.executionSystem] ?? FALLBACK_COLOR;
    let marker = markers.get(key);
    if (!marker) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:16px;height:16px;border-radius:50%;border:2.5px solid white;' +
        'box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer';
      marker = new maplibregl.Marker({ element: el })
        .setLngLat([v.lng, v.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml(v)))
        .addTo(map);
      markers.set(key, marker);
    } else {
      marker.setLngLat([v.lng, v.lat]);
      marker.getPopup()?.setHTML(popupHtml(v));
    }
    const el = marker.getElement();
    el.style.background = color;
    el.style.opacity = v.active ? '1' : '0.35';
  }
  // Vehicles that disappeared from the feed.
  for (const [key, marker] of markers) {
    if (!seen.has(key)) {
      marker.remove();
      markers.delete(key);
    }
  }
  if (!fitted && vehicles.value.length > 0 && map) {
    const bounds = new maplibregl.LngLatBounds();
    for (const v of vehicles.value) bounds.extend([v.lng, v.lat]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 13 });
    fitted = true;
  }
}

async function refresh(): Promise<void> {
  try {
    const res = await api.json<{ vehicles: VehiclePosition[] }>(
      `/clients/${clientId.value}/transport/positions`,
    );
    vehicles.value = res.vehicles;
    lastRefresh.value = new Date();
    error.value = null;
    renderMarkers();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(() => {
  if (!mapEl.value) return;
  map = new maplibregl.Map({
    container: mapEl.value,
    style: STYLE_URL,
    center: DEFAULT_CENTER,
    zoom: 5,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  void refresh();
  timer = setInterval(() => void refresh(), 10_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  map?.remove();
  map = null;
});

watch(clientId, () => {
  fitted = false;
  void refresh();
});
</script>

<template>
  <div class="flex h-full flex-col p-6">
    <PageHeader title="Vehicle map">
      <template #subtitle>
        Every vehicle across execution systems — live positions, faded when inactive (no fix in 10
        minutes).
      </template>
    </PageHeader>

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />

    <div class="mb-2 flex items-center gap-4 text-xs text-neutral-500">
      <span v-for="(color, system) in SYSTEM_COLORS" :key="system" class="flex items-center gap-1.5">
        <span
          class="inline-block size-3 rounded-full border-2 border-white shadow"
          :style="{ background: color }"
        />
        {{ system }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block size-3 rounded-full bg-neutral-400 opacity-40" />
        inactive
      </span>
      <span class="ml-auto">
        {{ vehicles.length }} vehicle(s)
        <template v-if="lastRefresh"> · refreshed {{ lastRefresh.toLocaleTimeString() }}</template>
      </span>
    </div>

    <div ref="mapEl" class="min-h-[480px] flex-1 overflow-hidden rounded-lg border border-neutral-200" />
  </div>
</template>
