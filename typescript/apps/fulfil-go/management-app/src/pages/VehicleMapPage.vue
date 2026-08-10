<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { L, osmTileLayer } from '../lib/leaflet-setup.js';
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
 * Leaflet + OpenStreetMap raster tiles (free, attribution required) —
 * replaced the MapLibre GL + style-URL stack 2026-08-10.
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

/** Centre of SA — sensible first view until positions arrive. */
const DEFAULT_CENTER: [number, number] = [-29.0, 25.0];

const mapEl = ref<HTMLDivElement | null>(null);
const vehicles = ref<VehiclePosition[]>([]);
const error = ref<string | null>(null);
const lastRefresh = ref<Date | null>(null);

let map: L.Map | null = null;
const markers = new Map<string, L.CircleMarker>();
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
      marker = L.circleMarker([v.lat, v.lng], { radius: 8 })
        .bindPopup(popupHtml(v))
        .bindTooltip(v.label ?? v.vehicleRef)
        .addTo(map);
      markers.set(key, marker);
    } else {
      marker.setLatLng([v.lat, v.lng]);
      marker.setPopupContent(popupHtml(v));
    }
    marker.setStyle({
      color: 'white',
      weight: 2.5,
      fillColor: color,
      fillOpacity: v.active ? 1 : 0.35,
      opacity: v.active ? 1 : 0.35,
    });
  }
  // Vehicles that disappeared from the feed.
  for (const [key, marker] of markers) {
    if (!seen.has(key)) {
      marker.remove();
      markers.delete(key);
    }
  }
  if (!fitted && vehicles.value.length > 0 && map) {
    const bounds = L.latLngBounds(vehicles.value.map((v) => [v.lat, v.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 13 });
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
  map = L.map(mapEl.value).setView(DEFAULT_CENTER, 5);
  osmTileLayer().addTo(map);
  void refresh();
  timer = setInterval(() => void refresh(), 10_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  map?.remove();
  map = null;
  markers.clear();
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
      <span
        v-for="(color, system) in SYSTEM_COLORS"
        :key="system"
        class="flex items-center gap-1.5"
      >
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

    <div
      ref="mapEl"
      class="z-0 min-h-[480px] flex-1 overflow-hidden rounded-lg border border-neutral-200"
    />
  </div>
</template>
