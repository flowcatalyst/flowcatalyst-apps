<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, clientId } from '../context.js';
import PageHeader from '../components/PageHeader.vue';

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

// Reka UI rejects empty-string select values — sentinel for "no filter".
const ALL = '__all__';

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

const orders = ref<TransportOrder[]>([]);
const trips = ref<Trip[]>([]);
const orderStatus = ref<string>(ALL);
const tripStatus = ref<string>(ALL);
const loading = ref(false);
const error = ref<string | null>(null);

const orderStatusOptions = computed(() => [
  { label: 'All statuses', value: ALL },
  ...ORDER_STATUSES.map((s) => ({ label: s, value: s })),
]);
const tripStatusOptions = computed(() => [
  { label: 'All statuses', value: ALL },
  ...TRIP_STATUSES.map((s) => ({ label: s, value: s })),
]);

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

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const orderQuery = orderStatus.value === ALL ? '' : `&statuses=${orderStatus.value}`;
    const tripQuery = tripStatus.value === ALL ? '' : `&statuses=${tripStatus.value}`;
    const [o, t] = await Promise.all([
      api.json<{ orders: TransportOrder[] }>(
        `/clients/${clientId.value}/transport/orders?limit=100${orderQuery}`,
      ),
      api.json<{ trips: Trip[] }>(
        `/clients/${clientId.value}/transport/trips?limit=100${tripQuery}`,
      ),
    ]);
    orders.value = o.orders;
    trips.value = t.trips;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void load();
  // Marketplace offers expire in 30s — a slow poll keeps the view honest.
  timer = setInterval(() => void load(), 30_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
watch([clientId, orderStatus, tripStatus], () => void load());
</script>

<template>
  <div class="p-6">
    <PageHeader title="Transport orders">
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

    <!-- Demand side: one order per picked part -->
    <div class="mb-2 flex items-center gap-3">
      <h2 class="text-sm font-semibold text-neutral-700">Orders</h2>
      <USelect v-model="orderStatus" :items="orderStatusOptions" size="xs" class="w-40" />
      <span class="text-xs text-neutral-400">{{ orders.length }} shown</span>
    </div>
    <div class="mb-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th class="px-3 py-2">Part</th>
            <th class="px-3 py-2">Status</th>
            <th class="px-3 py-2">Level</th>
            <th class="px-3 py-2">Store</th>
            <th class="px-3 py-2">Destination</th>
            <th class="px-3 py-2">Window</th>
            <th class="px-3 py-2">Bags</th>
            <th class="px-3 py-2">Provider</th>
            <th class="px-3 py-2">Driver</th>
            <th class="px-3 py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="orders.length === 0">
            <td colspan="10" class="px-3 py-6 text-center text-neutral-400">
              No transport orders{{ orderStatus === ALL ? '' : ` in '${orderStatus}'` }}.
            </td>
          </tr>
          <tr
            v-for="o in orders"
            :key="o.id"
            class="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
          >
            <td class="px-3 py-2">
              <span class="font-semibold">#{{ o.shortId }}</span>
              <span class="ml-1.5 font-mono text-[10px] text-neutral-400">{{ o.id }}</span>
            </td>
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
            <td class="px-3 py-2 text-xs">
              {{ o.courier?.name ?? '—' }}
              <span v-if="o.courier?.vehicleType" class="font-mono text-[10px] text-neutral-400">
                {{ o.courier.vehicleType }}
              </span>
            </td>
            <td
              class="max-w-56 truncate px-3 py-2 text-xs text-neutral-500"
              :title="o.failureReason ?? o.providerRef ?? ''"
            >
              {{ o.failureReason ?? o.providerRef ?? '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Planning side: trips (offers + claims, driver bound at offer time) -->
    <div class="mb-2 flex items-center gap-3">
      <h2 class="text-sm font-semibold text-neutral-700">Trips (claim marketplace)</h2>
      <USelect v-model="tripStatus" :items="tripStatusOptions" size="xs" class="w-40" />
      <span class="text-xs text-neutral-400">{{ trips.length }} shown</span>
    </div>
    <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
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
            <th class="px-3 py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="trips.length === 0">
            <td colspan="10" class="px-3 py-6 text-center text-neutral-400">
              No trips{{ tripStatus === ALL ? '' : ` in '${tripStatus}'` }} — offers appear when a
              driver requests claimable work.
            </td>
          </tr>
          <tr
            v-for="t in trips"
            :key="t.id"
            class="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
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
            <td
              class="max-w-56 truncate px-3 py-2 text-xs text-neutral-500"
              :title="t.failureReason ?? ''"
            >
              {{ t.failureReason ?? '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
