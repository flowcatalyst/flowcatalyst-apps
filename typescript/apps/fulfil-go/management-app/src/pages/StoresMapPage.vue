<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { L, osmTileLayer } from '../lib/leaflet-setup.js';
import { api, clientId } from '../context.js';
import { osmUrl } from '../lib/geo.js';
import PageHeader from '../components/PageHeader.vue';

/**
 * Store map — the whole registry on one map (Leaflet + OSM tiles). Read-only
 * situational view: where the stores are, which have no coordinates. Row-level
 * operations stay on the Stores grid (targeted-pages rule).
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

/** Centre of SA — sensible first view until stores load. */
const DEFAULT_CENTER: [number, number] = [-29.0, 25.0];

const mapEl = ref<HTMLDivElement | null>(null);
const stores = ref<StoreSummary[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);

let map: L.Map | null = null;
let markerLayer: L.LayerGroup | null = null;

const mapped = computed(() => stores.value.filter((s) => s.lat !== null && s.lng !== null));
const unmapped = computed(() => stores.value.length - mapped.value.length);

function popupHtml(s: StoreSummary): string {
  const esc = (v: string) => v.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const place = [s.city, s.region].filter(Boolean).join(', ');
  return `
    <div style="font: 12px Inter, sans-serif; min-width: 190px">
      <strong>${esc(s.name)}</strong><br/>
      <code style="color:#64748b">${esc(s.storeRef)}</code><br/>
      ${place ? `${esc(place)}<br/>` : ''}
      <span style="color:#64748b">Pick:</span> ${esc(s.pickProfileCode)} ·
      <span style="color:#64748b">Transport:</span> ${esc(s.transportProfileCode)}<br/>
      <a href="${osmUrl(s.lat as number, s.lng as number)}" target="_blank" rel="noopener">
        Open in OpenStreetMap
      </a>
    </div>`;
}

function render(): void {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  for (const s of mapped.value) {
    L.marker([s.lat as number, s.lng as number])
      .bindTooltip(`${s.storeRef} · ${s.name}`)
      .bindPopup(popupHtml(s))
      .addTo(markerLayer);
  }
  if (mapped.value.length > 0) {
    const bounds = L.latLngBounds(
      mapped.value.map((s) => [s.lat as number, s.lng as number] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`);
    stores.value = res.stores;
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
  markerLayer = L.layerGroup().addTo(map);
  void load();
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
  markerLayer = null;
});

watch(clientId, () => void load());
</script>

<template>
  <div class="flex h-full flex-col p-6">
    <PageHeader title="Store map">
      <template #subtitle>
        Every registered store on the map. Manage the registry on the Stores page.
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

    <div class="mb-2 flex items-center gap-4 text-xs text-neutral-500">
      <span>{{ mapped.length }} store(s) on the map</span>
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
