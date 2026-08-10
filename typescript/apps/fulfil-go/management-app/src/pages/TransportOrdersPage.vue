<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import { fmtDateTime } from '../lib/format.js';
import PageHeader from '../components/PageHeader.vue';
import InspectorPanel from '../components/InspectorPanel.vue';
import FilterBar from '../components/table/FilterBar.vue';
import SortableTh, { type SortState } from '../components/table/SortableTh.vue';
import TruncationFooter from '../components/table/TruncationFooter.vue';

/**
 * Transport operations view — the demand side (orders per picked part) and
 * the planning side (trips: what the claim marketplace offered/claimed,
 * with the driver + vehicle bound at offer time).
 */
interface TransportOrder {
  id: string;
  fulfilmentId: string;
  shortId: string;
  status: string;
  serviceLevel: string;
  originRef: string;
  destination: { name?: string; address?: { city?: string } } | null;
  slotStart: string;
  slotEnd: string;
  parcels: unknown[];
  provider: string;
  providerRef: string | null;
  courier: { name: string | null; vehicleType: string | null } | null;
  failureReason: string | null;
  updatedAt: string;
}

interface Trip {
  id: string;
  status: string;
  provider: string;
  originRef: string;
  driverRef: string;
  vehicleRef: string;
  stops: { orderId: string; shortId: string }[];
  offerExpiresAt: string;
  routeKm: number | null;
  routeMinutes: number | null;
  failureReason: string | null;
  updatedAt: string;
}

interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
}

const ORDER_STATUSES = [
  'requested',
  'booked',
  'assigned',
  'collected',
  'delivered',
  'failed',
  'cancelled',
];
const TRIP_STATUSES = ['offered', 'claimed', 'completed', 'expired', 'released'];

const route = useRoute();
const router = useRouter();
/**
 * /transport/requested renders this same component locked to the demand
 * backlog: orders in 'requested' only, oldest window first, no trips table
 * (a targeted page, not another spreadsheet view).
 */
const isRequestedView = computed(() => route.meta['transportView'] === 'requested');
const orders = ref<TransportOrder[]>([]);
const trips = ref<Trip[]>([]);
const stores = ref<StoreSummary[]>([]);
/** Any-of origin-store filter — applies to BOTH tables. */
const storeFilter = persistedFilter<string[]>('transport-orders', 'stores', []);
const orderStatuses = persistedFilter<string[]>('transport-orders', 'orderStatuses', []);
const tripStatuses = persistedFilter<string[]>('transport-orders', 'tripStatuses', []);
const orderSort = persistedFilter<SortState>('transport-orders', 'orderSort', {
  field: 'createdAt',
  dir: 'desc',
});
const loading = ref(false);
const error = ref<string | null>(null);

/** Both endpoints are requested with this limit. */
const LIMIT = 100;

const activeFilterCount = computed(() =>
  isRequestedView.value
    ? 0
    : (orderStatuses.value.length > 0 ? 1 : 0) + (tripStatuses.value.length > 0 ? 1 : 0),
);
const hasActiveFilters = computed(
  () => activeFilterCount.value > 0 || storeFilter.value.length > 0,
);
function clearFilters(): void {
  storeFilter.value = [];
  orderStatuses.value = [];
  tripStatuses.value = [];
}

const storeOptions = computed(() =>
  stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
);
const orderStatusOptions = ORDER_STATUSES.map((s) => ({ label: s, value: s }));
const tripStatusOptions = TRIP_STATUSES.map((s) => ({ label: s, value: s }));

const ORDER_BADGE: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-700',
  booked: 'bg-blue-100 text-blue-700',
  assigned: 'bg-indigo-100 text-indigo-700',
  collected: 'bg-violet-100 text-violet-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-neutral-200 text-neutral-600',
};
const TRIP_BADGE: Record<string, string> = {
  offered: 'bg-amber-100 text-amber-700',
  claimed: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-blue-100 text-blue-700',
  expired: 'bg-neutral-200 text-neutral-600',
  released: 'bg-red-100 text-red-700',
};

function badge(map: Record<string, string>, status: string): string {
  return map[status] ?? 'bg-neutral-200 text-neutral-600';
}

function fmtWindow(o: TransportOrder): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const start = new Date(o.slotStart);
  return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], opts)}–${new Date(o.slotEnd).toLocaleTimeString([], opts)}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function loadStores(): Promise<void> {
  try {
    const res = await api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`);
    stores.value = res.stores;
  } catch {
    stores.value = [];
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const orderParams = new URLSearchParams({
      limit: String(LIMIT),
      // Requested view: the backlog is always window-ordered.
      sort:
        isRequestedView.value || orderSort.value.field === 'slotStart' ? 'slotStart' : 'createdAt',
      dir: orderSort.value.dir,
    });
    const tripParams = new URLSearchParams({ limit: String(LIMIT) });
    if (storeFilter.value.length > 0) {
      orderParams.set('stores', storeFilter.value.join(','));
      tripParams.set('stores', storeFilter.value.join(','));
    }
    if (isRequestedView.value) {
      orderParams.set('statuses', 'requested');
    } else if (orderStatuses.value.length > 0) {
      orderParams.set('statuses', orderStatuses.value.join(','));
    }
    if (tripStatuses.value.length > 0) tripParams.set('statuses', tripStatuses.value.join(','));
    const o = await api.json<{ orders: TransportOrder[] }>(
      `/clients/${clientId.value}/transport/orders?${orderParams}`,
    );
    orders.value = o.orders;
    if (!isRequestedView.value) {
      const t = await api.json<{ trips: Trip[] }>(
        `/clients/${clientId.value}/transport/trips?${tripParams}`,
      );
      trips.value = t.trips;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

/** Panel selection (?selected=) — ids are unique across orders and trips. */
const selectedId = computed(() => (route.query['selected'] as string | undefined) ?? null);
const selectedOrder = computed(() => orders.value.find((o) => o.id === selectedId.value));
const selectedTrip = computed(() => trips.value.find((t) => t.id === selectedId.value));
function select(id: string): void {
  void router.replace({ query: { ...route.query, selected: id } });
}
function closePanel(): void {
  const { selected: _drop, ...rest } = route.query;
  void router.replace({ query: rest });
}
function viewFulfilment(fulfilmentId: string): void {
  void router.push({ path: '/fulfilments', query: { selected: fulfilmentId } });
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void loadStores();
  void load();
  // Marketplace offers expire in 30s — a slow poll keeps the view honest.
  timer = setInterval(() => void load(), 30_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
watch(clientId, () => {
  closePanel();
  storeFilter.value = [];
  void loadStores();
  void load();
});
watch([orderStatuses, tripStatuses, storeFilter, orderSort], () => void load(), { deep: true });
// The component is reused across /transport/orders and /transport/requested.
watch(isRequestedView, () => {
  closePanel();
  void load();
});
</script>

<template>
  <div class="flex h-full">
    <section class="min-w-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        :title="isRequestedView ? 'Requested transport' : 'Transport orders'"
        :subtitle="
          isRequestedView
            ? 'The demand backlog — picked parts waiting for a booking or a driver claim, oldest window first.'
            : 'Demand (orders per picked part) and planning (the claim marketplace trips).'
        "
      >
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

      <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-4" />

      <FilterBar
        :active-count="activeFilterCount"
        :has-active="hasActiveFilters"
        @clear="clearFilters"
      >
        <template #inline>
          <USelect
            v-model="storeFilter"
            multiple
            :items="storeOptions"
            value-key="value"
            placeholder="All stores"
            class="w-80"
          />
        </template>
        <template v-if="!isRequestedView" #filters>
          <div>
            <label class="mb-1 block text-xs font-medium text-neutral-500">Order status</label>
            <USelect
              v-model="orderStatuses"
              multiple
              :items="orderStatusOptions"
              value-key="value"
              placeholder="Any status"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-neutral-500">Trip status</label>
            <USelect
              v-model="tripStatuses"
              multiple
              :items="tripStatusOptions"
              value-key="value"
              placeholder="Any status"
              class="w-full"
            />
          </div>
        </template>
      </FilterBar>

      <!-- Demand side: one order per picked part -->
      <div class="mb-2 flex items-center gap-3">
        <h2 class="text-sm font-semibold text-neutral-700">
          {{ isRequestedView ? 'Awaiting booking / claim' : 'Orders' }}
        </h2>
        <span class="text-xs text-neutral-400">{{ orders.length }} shown</span>
      </div>
      <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th class="px-3 py-2">Part</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Level</th>
              <th class="px-3 py-2">Store</th>
              <th class="px-3 py-2">Destination</th>
              <SortableTh v-model="orderSort" field="slotStart" label="Window" />
              <th class="px-3 py-2">Bags</th>
              <th class="px-3 py-2">Provider</th>
              <th class="px-3 py-2">Driver</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="orders.length === 0">
              <td colspan="9" class="px-3 py-6 text-center text-neutral-400">
                No transport orders match the filters.
              </td>
            </tr>
            <tr
              v-for="o in orders"
              :key="o.id"
              class="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-brand-50/50"
              :class="{ 'bg-brand-50': o.id === selectedId }"
              @click="select(o.id)"
            >
              <td class="px-3 py-2 font-semibold">#{{ o.shortId }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  :class="badge(ORDER_BADGE, o.status)"
                >
                  {{ o.status }}
                </span>
              </td>
              <td class="px-3 py-2 text-xs">{{ o.serviceLevel }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ o.originRef }}</td>
              <td class="px-3 py-2 text-xs">
                {{ o.destination?.name ?? '—' }}
                <span v-if="o.destination?.address?.city" class="text-neutral-400">
                  · {{ o.destination.address.city }}
                </span>
              </td>
              <td class="px-3 py-2 text-xs whitespace-nowrap">{{ fmtWindow(o) }}</td>
              <td class="px-3 py-2 text-xs">{{ o.parcels.length }}</td>
              <td class="px-3 py-2 text-xs">{{ o.provider }}</td>
              <td class="px-3 py-2 text-xs">{{ o.courier?.name ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <TruncationFooter :shown="orders.length" :limit="LIMIT" />

      <!-- Planning side: trips (offers + claims, driver bound at offer time) -->
      <div v-if="!isRequestedView" class="mt-8 mb-2 flex items-center gap-3">
        <h2 class="text-sm font-semibold text-neutral-700">Trips (claim marketplace)</h2>
        <span class="text-xs text-neutral-400">{{ trips.length }} shown</span>
      </div>
      <div
        v-if="!isRequestedView"
        class="overflow-x-auto rounded-lg border border-neutral-200 bg-white"
      >
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th class="px-3 py-2">Trip</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Channel</th>
              <th class="px-3 py-2">Store</th>
              <th class="px-3 py-2">Driver</th>
              <th class="px-3 py-2">Vehicle</th>
              <th class="px-3 py-2">Stops</th>
              <th class="px-3 py-2">Route</th>
              <th class="px-3 py-2">Offer expiry</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="trips.length === 0">
              <td colspan="9" class="px-3 py-6 text-center text-neutral-400">
                No trips match the filters — offers appear when a driver requests claimable work.
              </td>
            </tr>
            <tr
              v-for="t in trips"
              :key="t.id"
              class="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-brand-50/50"
              :class="{ 'bg-brand-50': t.id === selectedId }"
              @click="select(t.id)"
            >
              <td class="px-3 py-2 font-mono text-xs">{{ t.id }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  :class="badge(TRIP_BADGE, t.status)"
                >
                  {{ t.status }}
                </span>
              </td>
              <td class="px-3 py-2 text-xs">{{ t.provider }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ t.originRef }}</td>
              <td class="px-3 py-2 text-xs">{{ t.driverRef }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ t.vehicleRef }}</td>
              <td class="px-3 py-2 text-xs">
                {{ t.stops.map((s) => `#${s.shortId}`).join(' → ') || '—' }}
              </td>
              <td class="px-3 py-2 text-xs whitespace-nowrap">
                <template v-if="t.routeKm !== null">
                  {{ t.routeKm.toFixed(1) }} km · {{ Math.round(t.routeMinutes ?? 0) }} min
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2 text-xs">{{ fmtTime(t.offerExpiresAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <TruncationFooter v-if="!isRequestedView" :shown="trips.length" :limit="LIMIT" />
    </section>

    <!-- Non-modal inspector panel — an order OR a trip, by id. -->
    <InspectorPanel
      v-if="selectedOrder"
      :title="`#${selectedOrder.shortId}`"
      :subtitle="selectedOrder.id"
      :status="selectedOrder.status"
      :status-tone="badge(ORDER_BADGE, selectedOrder.status)"
      @close="closePanel"
    >
      <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Service level</span>
          <span class="text-neutral-800">{{ selectedOrder.serviceLevel }}</span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Store</span>
          <span class="font-mono text-xs text-neutral-800">{{ selectedOrder.originRef }}</span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Destination</span>
          <span class="text-neutral-800">
            {{ selectedOrder.destination?.name ?? '—' }}
            <span v-if="selectedOrder.destination?.address?.city" class="text-neutral-500">
              · {{ selectedOrder.destination.address.city }}
            </span>
          </span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Window</span>
          <span class="text-neutral-800">{{ fmtWindow(selectedOrder) }}</span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Bags</span>
          <span class="text-neutral-800">{{ selectedOrder.parcels.length }}</span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Provider</span>
          <span class="text-neutral-800">
            {{ selectedOrder.provider }}
            <span v-if="selectedOrder.providerRef" class="font-mono text-xs text-neutral-400">
              {{ selectedOrder.providerRef }}
            </span>
          </span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Driver</span>
          <span class="text-neutral-800">
            {{ selectedOrder.courier?.name ?? '—' }}
            <span
              v-if="selectedOrder.courier?.vehicleType"
              class="font-mono text-xs text-neutral-400"
            >
              {{ selectedOrder.courier.vehicleType }}
            </span>
          </span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Updated</span>
          <span class="text-neutral-800">{{ fmtDateTime(selectedOrder.updatedAt) }}</span>
        </div>
      </div>

      <UAlert
        v-if="selectedOrder.failureReason"
        :description="selectedOrder.failureReason"
        color="error"
        variant="soft"
      />

      <UButton
        variant="soft"
        size="sm"
        icon="i-lucide-package-search"
        block
        @click="viewFulfilment(selectedOrder.fulfilmentId)"
      >
        View fulfilment
      </UButton>
    </InspectorPanel>

    <InspectorPanel
      v-else-if="selectedTrip"
      title="Trip"
      :subtitle="selectedTrip.id"
      :status="selectedTrip.status"
      :status-tone="badge(TRIP_BADGE, selectedTrip.status)"
      @close="closePanel"
    >
      <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Channel</span>
          <span class="text-neutral-800">{{ selectedTrip.provider }}</span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Store</span>
          <span class="font-mono text-xs text-neutral-800">{{ selectedTrip.originRef }}</span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Driver</span>
          <span class="text-neutral-800">{{ selectedTrip.driverRef || '—' }}</span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Vehicle</span>
          <span class="font-mono text-xs text-neutral-800">{{ selectedTrip.vehicleRef || '—' }}</span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Route</span>
          <span class="text-neutral-800">
            <template v-if="selectedTrip.routeKm !== null">
              {{ selectedTrip.routeKm.toFixed(1) }} km ·
              {{ Math.round(selectedTrip.routeMinutes ?? 0) }} min
            </template>
            <template v-else>—</template>
          </span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Offer expiry</span>
          <span class="text-neutral-800">{{ fmtDateTime(selectedTrip.offerExpiresAt) }}</span>
        </div>
      </div>

      <section>
        <h3 class="mb-2 text-sm font-semibold text-navy-700">
          Stops ({{ selectedTrip.stops.length }})
        </h3>
        <ol
          class="divide-y divide-neutral-100 rounded-lg border border-neutral-200 px-3 text-xs text-neutral-700"
        >
          <li
            v-for="(stop, i) in selectedTrip.stops"
            :key="stop.orderId"
            class="flex items-center gap-2 py-1.5"
          >
            <span class="w-5 text-neutral-400">{{ i + 1 }}.</span>
            <span class="font-mono font-medium">#{{ stop.shortId }}</span>
          </li>
          <li v-if="selectedTrip.stops.length === 0" class="py-1.5 text-neutral-400">No stops.</li>
        </ol>
      </section>

      <UAlert
        v-if="selectedTrip.failureReason"
        :description="selectedTrip.failureReason"
        color="error"
        variant="soft"
      />
    </InspectorPanel>
  </div>
</template>
