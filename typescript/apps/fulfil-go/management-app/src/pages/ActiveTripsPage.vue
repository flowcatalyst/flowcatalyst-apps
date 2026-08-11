<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { L, osmTileLayer } from '../lib/leaflet-setup.js';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import { fmtDateTime } from '../lib/format.js';
import PageHeader from '../components/PageHeader.vue';
import FilterBar from '../components/table/FilterBar.vue';

/**
 * Active trips — claimed trips being driven right now, filterable by depot
 * and store, with a planned-vs-actual map for the selected trip:
 *   PLANNED = dashed polyline store → stops (trip stop geo, VROOM order)
 *   ACTUAL  = the vehicle's latest live position (10s poll)
 * The server hard-restricts principals carrying a storeRef/depotRef
 * attribute to their own store/depot — the filters here only narrow further.
 */
interface ActiveTripStop {
  orderId: string;
  shortId: string;
  name: string;
  geo: { lat: number; lng: number } | null;
  /** Package barcodes the driver collects/hands over at this stop. */
  parcels: { ref: string; kind: string; size: string | null }[];
}
interface ActiveTrip {
  id: string;
  provider: string;
  originRef: string;
  depotRef: string | null;
  driverRef: string;
  vehicleRef: string;
  routeKm: number | null;
  routeMinutes: number | null;
  claimedAt: string;
  stops: ActiveTripStop[];
}
interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
  lat: number | null;
  lng: number | null;
}
interface DepotSummary {
  depotRef: string;
  name: string;
}
interface VehiclePosition {
  executionSystem: string;
  vehicleRef: string;
  lat: number;
  lng: number;
  recordedAt: string;
  active: boolean;
}

const PLANNED_COLOR = '#0967d2';
const ACTUAL_COLOR = '#059669'; // emerald — the live vehicle

const trips = ref<ActiveTrip[]>([]);
const stores = ref<StoreSummary[]>([]);
const depots = ref<DepotSummary[]>([]);
const positions = ref<VehiclePosition[]>([]);
const storeFilter = persistedFilter<string[]>('active-trips', 'stores', []);
const depotFilter = persistedFilter<string[]>('active-trips', 'depots', []);
const selectedId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let tripLayer: L.LayerGroup | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const storeOptions = computed(() =>
  stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
);
const depotOptions = computed(() =>
  depots.value.map((d) => ({ label: `${d.depotRef} · ${d.name}`, value: d.depotRef })),
);
const storeByRef = computed(() => new Map(stores.value.map((s) => [s.storeRef, s])));
const selected = computed(() => trips.value.find((t) => t.id === selectedId.value) ?? null);
const hasActiveFilters = computed(
  () => storeFilter.value.length > 0 || depotFilter.value.length > 0,
);
function clearFilters(): void {
  storeFilter.value = [];
  depotFilter.value = [];
}

/** The selected trip's live vehicle fix, if telemetry has one. */
const vehicleFix = computed(() => {
  const trip = selected.value;
  if (!trip) return null;
  return positions.value.find((p) => p.vehicleRef === trip.vehicleRef) ?? null;
});

async function loadRegistry(): Promise<void> {
  try {
    const [storeRes, depotRes] = await Promise.all([
      api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`),
      api.json<{ depots: DepotSummary[] }>(`/clients/${clientId.value}/depots`),
    ]);
    stores.value = storeRes.stores;
    depots.value = depotRes.depots;
  } catch {
    stores.value = [];
    depots.value = [];
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams();
    if (storeFilter.value.length > 0) params.set('stores', storeFilter.value.join(','));
    if (depotFilter.value.length > 0) params.set('depots', depotFilter.value.join(','));
    const res = await api.json<{ trips: ActiveTrip[] }>(
      `/clients/${clientId.value}/transport/active-trips?${params}`,
    );
    trips.value = res.trips;
    if (selectedId.value && !res.trips.some((t) => t.id === selectedId.value)) {
      selectedId.value = null;
    }
    selectedId.value ??= res.trips[0]?.id ?? null;
    renderTrip();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function pollPositions(): Promise<void> {
  try {
    const res = await api.json<{ vehicles: VehiclePosition[] }>(
      `/clients/${clientId.value}/transport/positions`,
    );
    positions.value = res.vehicles;
    renderTrip();
  } catch {
    // transient — next poll recovers
  }
}

function renderTrip(): void {
  if (!map || !tripLayer) return;
  const layer = tripLayer; // non-null capture for the closures below
  layer.clearLayers();
  const trip = selected.value;
  if (!trip) return;

  const origin = storeByRef.value.get(trip.originRef);
  const points: [number, number][] = [];
  if (origin?.lat != null && origin.lng != null) {
    points.push([origin.lat, origin.lng]);
    L.circleMarker([origin.lat, origin.lng], {
      radius: 9,
      color: 'white',
      weight: 2.5,
      fillColor: '#102a43',
      fillOpacity: 1,
    })
      .bindTooltip(`${trip.originRef} (origin)`)
      .addTo(layer);
  }
  trip.stops.forEach((stop, i) => {
    if (!stop.geo) return;
    points.push([stop.geo.lat, stop.geo.lng]);
    L.marker([stop.geo.lat, stop.geo.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;border-radius:50%;background:${PLANNED_COLOR};color:white;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:600 11px Inter,sans-serif">${i + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    })
      .bindTooltip(
        `${i + 1}. #${stop.shortId} — ${stop.name}` +
          (stop.parcels.length > 0 ? ` · ${stop.parcels.map((p) => p.ref).join(', ')}` : ''),
      )
      .addTo(layer);
  });
  if (points.length >= 2) {
    L.polyline(points, {
      color: PLANNED_COLOR,
      weight: 3,
      dashArray: '6 8',
      opacity: 0.8,
    }).addTo(layer);
  }

  const fix = vehicleFix.value;
  if (fix) {
    L.circleMarker([fix.lat, fix.lng], {
      radius: 9,
      color: 'white',
      weight: 2.5,
      fillColor: ACTUAL_COLOR,
      fillOpacity: fix.active ? 1 : 0.4,
    })
      .bindTooltip(
        `${trip.vehicleRef} — last fix ${new Date(fix.recordedAt).toLocaleTimeString()}`,
      )
      .addTo(layer);
    points.push([fix.lat, fix.lng]);
  }

  if (points.length > 0) {
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 14 });
  }
}

function select(id: string): void {
  selectedId.value = id;
  renderTrip();
}

onMounted(() => {
  if (mapEl.value) {
    map = L.map(mapEl.value).setView([-29.0, 25.0], 5);
    osmTileLayer().addTo(map);
    tripLayer = L.layerGroup().addTo(map);
  }
  void loadRegistry();
  void load();
  void pollPositions();
  pollTimer = setInterval(() => {
    void load();
    void pollPositions();
  }, 10_000);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  map?.remove();
  map = null;
  tripLayer = null;
});

watch([storeFilter, depotFilter], () => void load(), { deep: true });
watch(clientId, () => {
  clearFilters();
  selectedId.value = null;
  void loadRegistry();
  void load();
});
</script>

<template>
  <div class="flex h-full flex-col p-6">
    <PageHeader title="Active trips">
      <template #subtitle>
        Claimed trips on the road — planned route (dashed) vs the vehicle's live position. Users
        bound to a store or depot only see their own.
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

    <FilterBar :has-active="hasActiveFilters" @clear="clearFilters">
      <template #inline>
        <USelect
          v-model="depotFilter"
          multiple
          :items="depotOptions"
          value-key="value"
          placeholder="All depots"
          class="w-64"
        />
        <USelect
          v-model="storeFilter"
          multiple
          :items="storeOptions"
          value-key="value"
          placeholder="All stores"
          class="w-64"
        />
      </template>
      <template #meta>{{ trips.length }} active trip(s)</template>
    </FilterBar>

    <div class="flex min-h-0 flex-1 gap-4">
      <!-- Trip list -->
      <div class="w-96 shrink-0 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
        <div
          v-for="t in trips"
          :key="t.id"
          class="cursor-pointer border-b border-neutral-100 px-3 py-2.5 last:border-0 hover:bg-brand-50/50"
          :class="{ 'bg-brand-50': t.id === selectedId }"
          @click="select(t.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-xs font-semibold">{{ t.id }}</span>
            <span class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px]">{{ t.provider }}</span>
          </div>
          <p class="mt-0.5 text-xs text-neutral-600">
            <span class="font-mono">{{ t.originRef }}</span>
            → {{ t.stops.map((s) => `#${s.shortId}`).join(', ') }}
          </p>
          <p class="mt-0.5 text-[11px] text-neutral-400">
            {{ t.driverRef }} · {{ t.vehicleRef }}
            <template v-if="t.routeKm !== null">
              · {{ t.routeKm.toFixed(1) }} km / {{ Math.round(t.routeMinutes ?? 0) }} min
            </template>
            · claimed {{ fmtDateTime(t.claimedAt) }}
          </p>
          <!-- Selected trip: the driver's stop-by-stop package barcodes. -->
          <div v-if="t.id === selectedId" class="mt-2 flex flex-col gap-1.5">
            <div
              v-for="(stop, i) in t.stops"
              :key="stop.orderId"
              class="rounded border border-neutral-100 bg-neutral-50/60 px-2 py-1.5"
            >
              <p class="text-[11px] font-medium text-neutral-600">
                {{ i + 1 }}. #{{ stop.shortId }} — {{ stop.name }}
              </p>
              <p v-if="stop.parcels.length === 0" class="mt-0.5 text-[11px] text-neutral-400">
                no packages recorded
              </p>
              <div v-else class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="p in stop.parcels"
                  :key="p.ref"
                  class="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-neutral-700 ring-1 ring-neutral-200"
                  :title="`${p.kind}${p.size ? ` · ${p.size}` : ''}`"
                >
                  <UIcon
                    :name="p.kind === 'bag' ? 'i-lucide-shopping-bag' : 'i-lucide-package'"
                    class="mr-0.5 inline-block size-3 align-[-2px] text-neutral-400"
                  />{{ p.ref }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <p v-if="trips.length === 0 && !loading" class="px-3 py-8 text-center text-xs text-neutral-400">
          No active trips — claims appear here the moment a driver takes an offer.
        </p>
      </div>

      <!-- Planned vs actual map -->
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="mb-1.5 flex items-center gap-4 text-xs text-neutral-500">
          <span class="flex items-center gap-1.5">
            <span
              class="inline-block h-0.5 w-6"
              :style="{ borderTop: `3px dashed ${PLANNED_COLOR}` }"
            />
            planned route
          </span>
          <span class="flex items-center gap-1.5">
            <span
              class="inline-block size-3 rounded-full border-2 border-white shadow"
              :style="{ background: ACTUAL_COLOR }"
            />
            vehicle (live)
          </span>
          <span v-if="selected && !vehicleFix" class="text-amber-600">
            no telemetry yet for {{ selected.vehicleRef }}
          </span>
        </div>
        <div
          ref="mapEl"
          class="z-0 min-h-[420px] flex-1 overflow-hidden rounded-lg border border-neutral-200"
        />
      </div>
    </div>
  </div>
</template>
