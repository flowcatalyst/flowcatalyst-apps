<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FulfilmentInspector from '../components/FulfilmentInspector.vue';
import { createSseClient, type SseClient, type SseState } from '@fulfil-go/mobile-kit/sse';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import PageHeader from '../components/PageHeader.vue';

interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
}

interface FlightboardException {
  kind: string;
  fulfilmentId: string;
  externalRef: string;
  partShortId: string;
  storeRef: string;
  serviceLevel: string;
  slotStart: string;
  sinceMinutes: number;
  detail: string;
}

interface BoardPart {
  shortId: string;
  storeRef: string;
  status: string;
  pickStatus: string | null;
  exceptions: string[];
}

interface BoardRow {
  id: string;
  externalRef: string;
  type: string;
  serviceLevel: string;
  status: string;
  slotStart: string;
  slotEnd: string;
  stores: string[];
  parts: BoardPart[];
  exceptions: string[];
}

interface FlightboardData {
  kpis: {
    totalOrders: number;
    totalPicked: number;
    totalFailed: number;
    totalDelivered: number | null;
    pickedOnTimePct: number | null;
    pickedInFullPct: number | null;
    onTimePct: number | null;
    otifPct: number | null;
  };
  exceptions: FlightboardException[];
  board: BoardRow[];
}

const router = useRouter();
const data = ref<FlightboardData | null>(null);
const stores = ref<StoreSummary[]>([]);
const storeFilter = persistedFilter<string[]>('flightboard', 'stores', []);
const error = ref<string | null>(null);
const loading = ref(false);
const updatedAt = ref<Date | null>(null);

const storeOptions = computed(() =>
  stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
);

async function loadStores(): Promise<void> {
  try {
    const res = await api.json<{ stores: StoreSummary[] }>(`/clients/${clientId.value}/stores`);
    stores.value = res.stores;
  } catch {
    stores.value = [];
  }
}

/** Every store the registry offers this user — one click, no 100-row drag. */
function selectAllStores(): void {
  storeFilter.value = stores.value.map((s) => s.storeRef);
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const storesParam =
      storeFilter.value.length > 0
        ? `?stores=${encodeURIComponent(storeFilter.value.join(','))}`
        : '';
    data.value = await api.json<FlightboardData>(
      `/clients/${clientId.value}/flightboard${storesParam}`,
    );
    updatedAt.value = new Date();
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

/**
 * Liveness: SSE first (the /sse/ops stream nudges on any store-channel
 * event — pick created/claimed/completed/failed), polling as the fallback
 * AND the safety net. SSE open → slow 60s poll (covers signals store
 * channels don't carry, e.g. fulfilment creation); SSE down/unsupported →
 * the poll tightens to 15s so the board still works everywhere.
 */
const SSE_POLL_MS = 60_000;
const FALLBACK_POLL_MS = 15_000;
const sseState = ref<SseState>('closed');
let sse: SseClient | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;

function scheduleRefresh(): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => void refresh(), 500);
}

function startPolling(): void {
  clearInterval(timer);
  timer = setInterval(
    () => void refresh(),
    sseState.value === 'open' ? SSE_POLL_MS : FALLBACK_POLL_MS,
  );
}

function connectSse(): void {
  sse?.disconnect();
  sse = createSseClient({
    url: `/clients/${clientId.value}/sse/ops`,
    getHeaders: () => api.authHeaders(),
    onEvent: scheduleRefresh,
    onStateChange: (state) => {
      sseState.value = state;
      startPolling();
      if (state === 'open') scheduleRefresh();
    },
  });
  sse.connect();
}

onMounted(() => {
  void loadStores();
  void refresh();
  startPolling();
  connectSse();
});
onUnmounted(() => {
  clearInterval(timer);
  clearTimeout(debounce);
  sse?.disconnect();
});
watch(clientId, () => {
  storeFilter.value = [];
  void loadStores();
  void refresh();
  connectSse();
});
watch(storeFilter, () => void refresh());

/**
 * Row click docks the fulfilment inspector ON the flightboard (?selected=,
 * same deep-link semantics as the Fulfilments grid) — controllers never
 * lose the live board while inspecting.
 */
const route = useRoute();
const selectedId = computed(() => (route.query['selected'] as string | undefined) ?? null);
function open(row: { fulfilmentId?: string; id?: string }): void {
  const id = row.fulfilmentId ?? row.id;
  if (id) void router.replace({ query: { ...route.query, selected: id } });
}
function closePanel(): void {
  const { selected: _drop, ...rest } = route.query;
  void router.replace({ query: rest });
}

/** Exception kind → label + tone. Transport kinds land with that context. */
const EXCEPTION_META: Record<string, { label: string; classes: string }> = {
  release_overdue: { label: 'Release overdue', classes: 'bg-red-50 text-red-700' },
  pick_late_unclaimed: { label: 'Pick unclaimed', classes: 'bg-amber-50 text-amber-700' },
  pick_late_incomplete: { label: 'Picking late', classes: 'bg-orange-50 text-orange-700' },
  // Handover evidence failed/missing (docs/handover-verification.md) —
  // deferred verification recorded a mismatch; ops follows up.
  delivery_verification_mismatch: { label: 'Verify handover', classes: 'bg-red-50 text-red-700' },
};
const exceptionMeta = (kind: string) =>
  EXCEPTION_META[kind] ?? { label: kind, classes: 'bg-neutral-100 text-neutral-600' };

const exceptionCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const e of data.value?.exceptions ?? []) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()];
});

const statusColor: Record<string, string> = {
  created: 'text-brand-600 bg-brand-50',
  in_progress: 'text-amber-700 bg-amber-50',
  ready: 'text-emerald-700 bg-emerald-50',
  completing: 'text-emerald-700 bg-emerald-50',
};

function fmtSince(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
}
function fmtPct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}
</script>

<template>
  <div class="flex h-full">
    <section class="min-w-0 flex-1 overflow-y-auto p-6">
    <PageHeader
      title="Flightboard"
      subtitle="Live controller view — ±24h slot window, ASAP first, exceptions on top."
    >
      <template #actions>
        <span class="flex items-center gap-1.5 text-xs text-neutral-400">
          <span
            class="inline-block size-2 rounded-full"
            :class="sseState === 'open' ? 'bg-emerald-500' : 'bg-neutral-300'"
            :title="sseState === 'open' ? 'Live (SSE)' : 'Polling'"
          />
          {{ sseState === 'open' ? 'live' : 'polling' }}
        </span>
        <span v-if="updatedAt" class="text-xs text-neutral-400">
          updated {{ updatedAt.toLocaleTimeString('en-ZA') }}
        </span>
        <UButton
          size="sm"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="refresh"
        >
          Refresh
        </UButton>
      </template>
    </PageHeader>

    <div class="mb-4 flex items-center gap-2">
      <USelect
        v-model="storeFilter"
        multiple
        :items="storeOptions"
        value-key="value"
        placeholder="All stores"
        class="w-96"
      />
      <UButton
        v-if="storeFilter.length < stores.length"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-list-checks"
        @click="selectAllStores"
      >
        Select all ({{ stores.length }})
      </UButton>
      <UButton
        v-if="storeFilter.length > 0"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-list-x"
        @click="storeFilter = []"
      >
        Clear all ({{ storeFilter.length }})
      </UButton>
    </div>

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-4" />

    <!-- KPI tiles -->
    <div v-if="data" class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      <div
        v-for="tile in [
          { label: 'Orders', value: String(data.kpis.totalOrders) },
          { label: 'Picked', value: String(data.kpis.totalPicked) },
          {
            label: 'Failed',
            value: String(data.kpis.totalFailed),
            alert: data.kpis.totalFailed > 0,
          },
          {
            label: 'Delivered',
            value: data.kpis.totalDelivered === null ? '—' : String(data.kpis.totalDelivered),
            pending: data.kpis.totalDelivered === null,
          },
          { label: 'Picked on time', value: fmtPct(data.kpis.pickedOnTimePct) },
          { label: 'Picked in full', value: fmtPct(data.kpis.pickedInFullPct) },
          {
            label: 'On time',
            value: fmtPct(data.kpis.onTimePct),
            pending: data.kpis.onTimePct === null,
          },
          { label: 'OTIF', value: fmtPct(data.kpis.otifPct), pending: data.kpis.otifPct === null },
        ]"
        :key="tile.label"
        class="rounded-lg border border-neutral-200 bg-white p-3"
      >
        <p class="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          {{ tile.label }}
        </p>
        <p
          class="mt-0.5 text-2xl font-semibold"
          :class="tile.alert ? 'text-red-600' : tile.pending ? 'text-neutral-300' : 'text-navy-900'"
        >
          {{ tile.value }}
        </p>
        <p v-if="tile.pending" class="text-[10px] text-neutral-400">awaits transport</p>
      </div>
    </div>

    <!-- Exceptions -->
    <section v-if="data && data.exceptions.length > 0" class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <h2 class="text-sm font-semibold text-navy-700">
          Exceptions ({{ data.exceptions.length }})
        </h2>
        <span
          v-for="[kind, count] in exceptionCounts"
          :key="kind"
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="exceptionMeta(kind).classes"
        >
          {{ exceptionMeta(kind).label }} · {{ count }}
        </span>
      </div>
      <div class="max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
        <button
          v-for="(e, i) in data.exceptions.slice(0, 100)"
          :key="`${e.fulfilmentId}-${e.partShortId}-${e.kind}`"
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-50"
          :class="{ 'border-t border-neutral-100': i > 0 }"
          @click="open(e)"
        >
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
            :class="exceptionMeta(e.kind).classes"
          >
            {{ exceptionMeta(e.kind).label }}
          </span>
          <span class="font-mono text-xs">{{ e.externalRef }} #{{ e.partShortId }}</span>
          <span class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">
            {{ e.storeRef }}
          </span>
          <span
            v-if="e.serviceLevel === 'ASAP'"
            class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
          >
            ASAP
          </span>
          <span class="min-w-0 flex-1 truncate text-xs text-neutral-500">{{ e.detail }}</span>
          <span class="shrink-0 text-xs font-medium text-red-600">{{
            fmtSince(e.sinceMinutes)
          }}</span>
        </button>
      </div>
    </section>

    <!-- Board -->
    <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
            <th class="px-3 py-2">Ref</th>
            <th class="px-3 py-2">Level</th>
            <th class="px-3 py-2">Slot</th>
            <th class="px-3 py-2">Status</th>
            <th class="px-3 py-2">Parts / picks</th>
            <th class="px-3 py-2">Exceptions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in data?.board ?? []"
            :key="row.id"
            class="cursor-pointer border-t border-neutral-100 hover:bg-brand-50/50"
            :class="{ 'bg-red-50/40': row.exceptions.length > 0 }"
            @click="open(row)"
          >
            <td class="px-3 py-2 font-mono text-xs">{{ row.externalRef }}</td>
            <td class="px-3 py-2">
              <span
                v-if="row.serviceLevel === 'ASAP'"
                class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
              >
                ASAP
              </span>
              <span v-else class="text-xs text-neutral-500">STD</span>
            </td>
            <td class="px-3 py-2 text-neutral-500">{{ fmtSlot(row.slotStart) }}</td>
            <td class="px-3 py-2">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="statusColor[row.status] ?? 'text-neutral-600 bg-neutral-100'"
              >
                {{ row.status }}
              </span>
            </td>
            <td class="px-3 py-2">
              <span
                v-for="part in row.parts"
                :key="part.shortId"
                class="mr-1 inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px]"
                :class="{ 'bg-red-100 text-red-700': part.exceptions.length > 0 }"
                :title="`${part.storeRef} · part ${part.status}${part.pickStatus ? ` · pick ${part.pickStatus}` : ''}`"
              >
                #{{ part.shortId }}
                <span class="text-neutral-400">{{ part.pickStatus ?? part.status }}</span>
              </span>
            </td>
            <td class="px-3 py-2">
              <span
                v-for="kind in row.exceptions"
                :key="kind"
                class="mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                :class="exceptionMeta(kind).classes"
              >
                {{ exceptionMeta(kind).label }}
              </span>
            </td>
          </tr>
          <tr v-if="data && data.board.length === 0">
            <td colspan="6" class="px-3 py-8 text-center text-neutral-400">
              Nothing in flight — all quiet.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    </section>

    <FulfilmentInspector
      v-if="selectedId"
      :fulfilment-id="selectedId"
      @close="closePanel"
      @changed="refresh"
    />
  </div>
</template>
