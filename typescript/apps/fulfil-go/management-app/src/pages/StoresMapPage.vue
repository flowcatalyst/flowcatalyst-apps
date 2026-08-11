<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { L, osmTileLayer } from '../lib/leaflet-setup.js';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import PageHeader from '../components/PageHeader.vue';

/**
 * Network map — stores AND depots on one map (Leaflet + OSM tiles), each on
 * its own toggleable layer. Read-only situational view; registry management
 * stays on the Stores/Depots grids (targeted-pages rule).
 *
 * Deep-link focus: ?focus=<storeRef> or ?focusDepot=<depotRef> zooms to that
 * entity and opens its popup — the Stores/Depots grids' "Map" links land here.
 */
interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  pickProfileCode: string;
  transportProfileCode: string;
}

interface DepotSummary {
  depotRef: string;
  name: string;
  geo: { lat: number; lng: number } | null;
  storeRefs: string[];
}

/** Centre of SA — sensible first view until data loads. */
const DEFAULT_CENTER: [number, number] = [-29.0, 25.0];
const DEPOT_COLOR = '#7c3aed'; // violet — matches the depot/EPOD accent elsewhere

const route = useRoute();
const mapEl = ref<HTMLDivElement | null>(null);
const stores = ref<StoreSummary[]>([]);
const depots = ref<DepotSummary[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
const showStores = persistedFilter('network-map', 'showStores', true);
const showDepots = persistedFilter('network-map', 'showDepots', true);

let map: L.Map | null = null;
let storeLayer: L.LayerGroup | null = null;
let depotLayer: L.LayerGroup | null = null;
let fitted = false;

const mappedStores = computed(() => stores.value.filter((s) => s.lat !== null && s.lng !== null));
const mappedDepots = computed(() => depots.value.filter((d) => d.geo !== null));
const unmapped = computed(
  () =>
    stores.value.length -
    mappedStores.value.length +
    (depots.value.length - mappedDepots.value.length),
);

function esc(v: string): string {
  return v.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function storePopup(s: StoreSummary): string {
  const place = [s.city, s.region].filter(Boolean).join(', ');
  return `
    <div style="font: 12px Inter, sans-serif; min-width: 190px">
      <strong>${esc(s.name)}</strong><br/>
      <code style="color:#64748b">${esc(s.storeRef)}</code><br/>
      ${place ? `${esc(place)}<br/>` : ''}
      <span style="color:#64748b">Pick:</span> ${esc(s.pickProfileCode)} ·
      <span style="color:#64748b">Transport:</span> ${esc(s.transportProfileCode)}
    </div>`;
}

function depotPopup(d: DepotSummary): string {
  return `
    <div style="font: 12px Inter, sans-serif; min-width: 190px">
      <strong>${esc(d.name)}</strong> <span style="color:#7c3aed">(depot)</span><br/>
      <code style="color:#64748b">${esc(d.depotRef)}</code><br/>
      <span style="color:#64748b">Serves:</span> ${esc(d.storeRefs.join(', ') || '—')}
    </div>`;
}

function render(): void {
  if (!map || !storeLayer || !depotLayer) return;
  storeLayer.clearLayers();
  depotLayer.clearLayers();
  const storeMarkers = new Map<string, L.Marker>();
  const depotMarkers = new Map<string, L.CircleMarker>();
  for (const s of mappedStores.value) {
    const marker = L.marker([s.lat as number, s.lng as number])
      .bindTooltip(`${s.storeRef} · ${s.name}`)
      .bindPopup(storePopup(s))
      .addTo(storeLayer);
    storeMarkers.set(s.storeRef, marker);
  }
  for (const d of mappedDepots.value) {
    const geo = d.geo as { lat: number; lng: number };
    const marker = L.circleMarker([geo.lat, geo.lng], {
      radius: 10,
      color: 'white',
      weight: 2.5,
      fillColor: DEPOT_COLOR,
      fillOpacity: 0.95,
    })
      .bindTooltip(`${d.depotRef} · ${d.name}`)
      .bindPopup(depotPopup(d))
      .addTo(depotLayer);
    depotMarkers.set(d.depotRef, marker);
  }

  // Deep-link focus beats whole-network fitBounds.
  const focusStore = route.query['focus'] as string | undefined;
  const focusDepot = route.query['focusDepot'] as string | undefined;
  if (!fitted && focusStore && storeMarkers.has(focusStore)) {
    const marker = storeMarkers.get(focusStore)!;
    showStores.value = true;
    map.setView(marker.getLatLng(), 15);
    marker.openPopup();
    fitted = true;
    return;
  }
  if (!fitted && focusDepot && depotMarkers.has(focusDepot)) {
    const marker = depotMarkers.get(focusDepot)!;
    showDepots.value = true;
    map.setView(marker.getLatLng(), 14);
    marker.openPopup();
    fitted = true;
    return;
  }

  if (!fitted) {
    const points: [number, number][] = [
      ...mappedStores.value.map((s) => [s.lat as number, s.lng as number] as [number, number]),
      ...mappedDepots.value.map(
        (d) => [(d.geo as { lat: number }).lat, (d.geo as { lng: number }).lng] as [number, number],
      ),
    ];
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 12 });
      fitted = true;
    }
  }
}

function syncLayerVisibility(): void {
  if (!map || !storeLayer || !depotLayer) return;
  const sync = (layer: L.LayerGroup, on: boolean) => {
    if (on && !map!.hasLayer(layer)) layer.addTo(map!);
    if (!on && map!.hasLayer(layer)) layer.remove();
  };
  sync(storeLayer, showStores.value);
  sync(depotLayer, showDepots.value);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [storeRes, depotRes] = await Promise.all([
      api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`),
      api.json<{ depots: DepotSummary[] }>(`/clients/${clientId.value}/depots`),
    ]);
    stores.value = storeRes.stores;
    depots.value = depotRes.depots;
    render();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (!mapEl.value) return;
  map = L.map(mapEl.value).setView(DEFAULT_CENTER, 5);
  osmTileLayer().addTo(map);
  storeLayer = L.layerGroup();
  depotLayer = L.layerGroup();
  syncLayerVisibility();
  void load();
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
  storeLayer = null;
  depotLayer = null;
});

watch([showStores, showDepots], syncLayerVisibility);
watch(clientId, () => {
  fitted = false;
  void load();
});
</script>

<template>
  <div class="flex h-full flex-col p-6">
    <PageHeader title="Network map">
      <template #subtitle>
        Stores and depots on one map — toggle either layer. Manage them on their own pages.
      </template>
      <template #actions>
        <UButton
          size="sm"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="load"
        >
          Refresh
        </UButton>
      </template>
    </PageHeader>

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />

    <div class="mb-2 flex items-center gap-5 text-xs text-neutral-600">
      <UCheckbox v-model="showStores">
        <template #label>
          <span class="flex items-center gap-1.5 text-xs">
            <UIcon name="i-lucide-map-pin" class="size-3.5 text-brand-600" />
            Stores ({{ mappedStores.length }})
          </span>
        </template>
      </UCheckbox>
      <UCheckbox v-model="showDepots">
        <template #label>
          <span class="flex items-center gap-1.5 text-xs">
            <span
              class="inline-block size-3 rounded-full border-2 border-white shadow"
              :style="{ background: DEPOT_COLOR }"
            />
            Depots ({{ mappedDepots.length }})
          </span>
        </template>
      </UCheckbox>
      <span v-if="unmapped > 0" class="text-amber-600">
        {{ unmapped }} without coordinates — not shown
      </span>
    </div>

    <div
      ref="mapEl"
      class="z-0 min-h-[480px] flex-1 overflow-hidden rounded-lg border border-neutral-200"
    />
  </div>
</template>
