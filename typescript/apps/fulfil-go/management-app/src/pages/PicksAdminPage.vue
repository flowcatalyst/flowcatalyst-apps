<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { PickDto } from '@fulfil-go/shared';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import { fmtDateTime as fmt } from '../lib/format.js';
import PageHeader from '../components/PageHeader.vue';
import InspectorPanel from '../components/InspectorPanel.vue';
import FilterBar from '../components/table/FilterBar.vue';
import SortableTh, { type SortState } from '../components/table/SortableTh.vue';
import TruncationFooter from '../components/table/TruncationFooter.vue';

/**
 * Back-office pick views — one component, three routes:
 *   /picking/picks/requested  (meta.pickStatus 'requested')  — waiting for a picker
 *   /picking/picks/active     (meta.pickStatus 'claimed')    — being picked right now
 *   /picking/picks/enquiry    (meta.pickStatus 'enquiry')    — ANY pick, any status
 */
interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
  city: string | null;
  region: string | null;
}

const route = useRoute();
const router = useRouter();
const view = computed(
  () => (route.meta['pickStatus'] as 'requested' | 'claimed' | 'enquiry') ?? 'requested',
);
const isActiveView = computed(() => view.value === 'claimed');
const isEnquiry = computed(() => view.value === 'enquiry');

const PICK_STATUSES = ['requested', 'claimed', 'picked', 'short_picked', 'failed'];
/** Enquiry-only status narrowing; 'all' = no status param. */
const statusChoice = persistedFilter<string>('picks-enquiry', 'status', 'all');
const statusOptions = [
  { label: 'All statuses', value: 'all' },
  ...PICK_STATUSES.map((s) => ({ label: s.replaceAll('_', ' '), value: s })),
];

const picks = ref<PickDto[]>([]);
const pickerNames = ref<Record<string, string>>({});
const stores = ref<StoreSummary[]>([]);
/** Any-of store filter (CSV on the wire). */
const storeFilter = persistedFilter<string[]>('picks-admin', 'stores', []);
/** Server-side shortId prefix search. */
const search = persistedFilter<string>('picks-admin', 'q', '');
const loading = ref(false);
const error = ref<string | null>(null);

/** Slot-window presets; 'custom' opens the two date inputs. */
type SlotRange = 'all' | 'overdue' | 'today' | 'next48h' | 'next7d' | 'custom';
const slotRange = persistedFilter<SlotRange>('picks-admin', 'slotRange', 'all');
const customFrom = persistedFilter<string>('picks-admin', 'slotFrom', '');
const customTo = persistedFilter<string>('picks-admin', 'slotTo', '');
const sort = persistedFilter<SortState>('picks-admin', 'sort', { field: 'slotStart', dir: 'asc' });

/** Popover-filter count for the FilterBar badge (store select is inline). */
const activeFilterCount = computed(() => (slotRange.value !== 'all' ? 1 : 0));
const hasActiveFilters = computed(
  () =>
    slotRange.value !== 'all' || storeFilter.value.length > 0 || search.value.trim().length > 0,
);
function clearFilters(): void {
  storeFilter.value = [];
  slotRange.value = 'all';
  customFrom.value = '';
  customTo.value = '';
  search.value = '';
}

/** Server cap on /picks/admin (pick-repository listByClient default). */
const SERVER_LIMIT = 200;

const rangeOptions = [
  { label: 'All slots', value: 'all' },
  { label: 'Overdue (slot passed)', value: 'overdue' },
  { label: 'Today', value: 'today' },
  { label: 'Next 48 hours', value: 'next48h' },
  { label: 'Next 7 days', value: 'next7d' },
  { label: 'Custom range…', value: 'custom' },
] as const;

/** Resolve the active preset to inclusive slotStart bounds (ISO or null). */
function slotWindow(): { from: string | null; to: string | null } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = (base: Date, hours: number): Date => new Date(base.getTime() + hours * 3_600_000);
  switch (slotRange.value) {
    case 'overdue':
      return { from: null, to: now.toISOString() };
    case 'today':
      return { from: startOfDay.toISOString(), to: plus(startOfDay, 24).toISOString() };
    case 'next48h':
      return { from: now.toISOString(), to: plus(now, 48).toISOString() };
    case 'next7d':
      return { from: startOfDay.toISOString(), to: plus(startOfDay, 24 * 7).toISOString() };
    case 'custom': {
      // Date-only inputs: from = start of that day, to = END of that day.
      const from = customFrom.value ? new Date(`${customFrom.value}T00:00:00`) : null;
      const to = customTo.value ? new Date(`${customTo.value}T23:59:59.999`) : null;
      return { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null };
    }
    default:
      return { from: null, to: null };
  }
}

const storeOptions = computed(() =>
  stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
);
const storeNames = computed(() => new Map(stores.value.map((s) => [s.storeRef, s.name])));

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
    const params = new URLSearchParams({ slotOrder: sort.value.dir });
    if (isEnquiry.value) {
      if (statusChoice.value !== 'all') params.set('status', statusChoice.value);
    } else {
      params.set('status', view.value);
    }
    if (storeFilter.value.length > 0) params.set('store', storeFilter.value.join(','));
    if (search.value.trim()) params.set('q', search.value.trim());
    const { from, to } = slotWindow();
    if (from) params.set('slotFrom', from);
    if (to) params.set('slotTo', to);
    const res = await api.json<{ picks: PickDto[]; pickers: Record<string, string> }>(
      `/clients/${clientId.value}/picks/admin?${params}`,
    );
    picks.value = res.picks;
    pickerNames.value = res.pickers;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function units(pick: PickDto): number {
  return pick.lines.reduce((sum, l) => sum + ((l as { quantity?: number }).quantity ?? 0), 0);
}
function lineText(line: unknown): { qty: number; description: string; sku: string } {
  const l = line as { quantity?: number; description?: string; sku?: string };
  return { qty: l.quantity ?? 0, description: l.description ?? '—', sku: l.sku ?? '' };
}

/** Panel selection lives in the route query — deep links + back/forward work. */
const selectedId = computed(() => (route.query['selected'] as string | undefined) ?? null);
/** Deep-link fallback: the selected pick may be outside the filtered page. */
const fetchedPick = ref<PickDto | null>(null);
const selected = computed(
  () =>
    picks.value.find((p) => p.id === selectedId.value) ??
    (fetchedPick.value?.id === selectedId.value ? fetchedPick.value : undefined),
);
watch([selectedId, picks], async ([id]) => {
  if (!id || picks.value.some((p) => p.id === id)) {
    fetchedPick.value = null;
    return;
  }
  try {
    const res = await api.json<{ pick: PickDto; pickers: Record<string, string> }>(
      `/clients/${clientId.value}/picks/admin/${id}`,
    );
    fetchedPick.value = res.pick;
    pickerNames.value = { ...pickerNames.value, ...res.pickers };
  } catch {
    fetchedPick.value = null;
  }
});
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

const pickStatusColor: Record<string, string> = {
  requested: 'bg-brand-50 text-brand-700',
  claimed: 'bg-amber-50 text-amber-700',
  picked: 'bg-emerald-50 text-emerald-700',
  short_picked: 'bg-orange-50 text-orange-700',
  failed: 'bg-red-50 text-red-700',
};

/** Light poll — the admin view doesn't hold an SSE store stream. */
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void loadStores();
  void load();
  timer = setInterval(() => void load(), 30_000);
});
onUnmounted(() => clearInterval(timer));
watch([clientId], () => {
  closePanel();
  storeFilter.value = [];
  void loadStores();
  void load();
});
watch([view, statusChoice, storeFilter, slotRange, customFrom, customTo, sort], () => void load(), {
  deep: true,
});
// Debounce the server-side quick-search so typing doesn't fire per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 300);
});
</script>

<template>
  <div class="flex h-full">
    <!-- Grid stays fully interactive while the panel is open. -->
    <section class="min-w-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        :title="isEnquiry ? 'Pick enquiry' : isActiveView ? 'Active picks' : 'Requested picks'"
        :subtitle="
          isEnquiry
            ? 'Any pick, any status — search by part number and inspect.'
            : isActiveView
              ? 'Claimed and being picked right now, per store and picker.'
              : 'Released to stores and waiting for a picker to claim.'
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

      <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />

      <FilterBar
        v-model:search="search"
        show-search
        search-placeholder="Search part #…"
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
          <USelect
            v-if="isEnquiry"
            v-model="statusChoice"
            :items="statusOptions"
            value-key="value"
            class="w-44"
          />
        </template>
        <template #filters>
          <div>
            <label class="mb-1 block text-xs font-medium text-neutral-500">Slot window</label>
            <USelect
              v-model="slotRange"
              :items="[...rangeOptions]"
              value-key="value"
              icon="i-lucide-calendar-range"
              class="w-full"
            />
          </div>
          <div v-if="slotRange === 'custom'" class="flex items-center gap-2">
            <UInput v-model="customFrom" type="date" size="sm" aria-label="Slot from" />
            <span class="text-xs text-neutral-400">to</span>
            <UInput v-model="customTo" type="date" size="sm" aria-label="Slot to" />
          </div>
        </template>
        <template #meta>{{ picks.length }} pick(s)</template>
      </FilterBar>

      <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
              <th class="px-3 py-2">Part</th>
              <th class="px-3 py-2">Store</th>
              <SortableTh v-model="sort" field="slotStart" label="Slot" />
              <th class="px-3 py-2">Lines</th>
              <th class="px-3 py-2">Level</th>
              <th v-if="isEnquiry" class="px-3 py-2">Status</th>
              <th v-if="isActiveView" class="px-3 py-2">Picker</th>
              <th v-if="isActiveView" class="px-3 py-2">Claimed</th>
              <th v-if="!isActiveView" class="px-3 py-2">
                {{ isEnquiry ? 'Requested' : 'Waiting since' }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in picks"
              :key="p.id"
              class="cursor-pointer border-t border-neutral-100 hover:bg-brand-50/50"
              :class="{ 'bg-brand-50': p.id === selectedId }"
              @click="select(p.id)"
            >
              <td class="px-3 py-2 font-mono font-medium">#{{ p.shortId }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs"
                  :title="storeNames.get(p.storeRef) ?? p.storeRef"
                >
                  {{ p.storeRef }}
                </span>
              </td>
              <td class="px-3 py-2 text-neutral-500">{{ fmt(p.slotStart) }}</td>
              <td class="px-3 py-2">{{ p.lines.length }} / {{ units(p) }}u</td>
              <td class="px-3 py-2">
                <span
                  v-if="p.serviceLevel === 'ASAP'"
                  class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                >
                  ASAP
                </span>
                <span v-else class="text-xs text-neutral-500">STD</span>
                <span
                  v-if="p.requireFullPick"
                  class="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                  title="Fulfilment does not allow partial fulfilment"
                >
                  FULL
                </span>
              </td>
              <td v-if="isEnquiry" class="px-3 py-2">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="pickStatusColor[p.status] ?? 'bg-neutral-100 text-neutral-600'"
                >
                  {{ p.status }}
                </span>
              </td>
              <td v-if="isActiveView" class="px-3 py-2">
                {{ (p.claimedBy && pickerNames[p.claimedBy]) || p.claimedBy || '—' }}
              </td>
              <td v-if="isActiveView" class="px-3 py-2 text-neutral-500">{{ fmt(p.claimedAt) }}</td>
              <td v-if="!isActiveView" class="px-3 py-2 text-neutral-500">
                {{ fmt(p.createdAt) }}
              </td>
            </tr>
            <tr v-if="picks.length === 0 && !loading">
              <td colspan="7" class="px-3 py-8 text-center text-neutral-400">
                {{ isActiveView ? 'No picks in progress.' : 'No picks waiting to be claimed.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <TruncationFooter :shown="picks.length" :limit="SERVER_LIMIT" />
    </section>

    <!-- Non-modal inspector panel (ui-guidelines.md) — row click swaps content. -->
    <InspectorPanel
      v-if="selected"
      :title="`#${selected.shortId}`"
      :subtitle="selected.id"
      :status="selected.status"
      :status-tone="pickStatusColor[selected.status]"
      @close="closePanel"
    >
      <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Store</span>
          <span class="text-neutral-800">
            {{ storeNames.get(selected.storeRef) ?? selected.storeRef }}
            <span class="font-mono text-xs text-neutral-400">({{ selected.storeRef }})</span>
          </span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Service level</span>
          <span class="text-neutral-800">
            {{ selected.serviceLevel }}
            <span
              v-if="selected.requireFullPick"
              class="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
            >
              FULL
            </span>
          </span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Slot</span>
          <span class="text-neutral-800">
            {{ fmt(selected.slotStart) }} – {{ fmt(selected.slotEnd) }}
          </span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Requested</span>
          <span class="text-neutral-800">{{ fmt(selected.createdAt) }}</span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Picker</span>
          <span class="text-neutral-800">
            {{ (selected.claimedBy && pickerNames[selected.claimedBy]) || selected.claimedBy || '—' }}
            <template v-if="selected.claimedAt">
              <span class="text-xs text-neutral-400">since {{ fmt(selected.claimedAt) }}</span>
            </template>
          </span>
        </div>
      </div>

      <section>
        <h3 class="mb-2 text-sm font-semibold text-navy-700">
          Lines ({{ selected.lines.length }} / {{ units(selected) }}u)
        </h3>
        <ul
          class="divide-y divide-neutral-100 rounded-lg border border-neutral-200 px-3 text-xs text-neutral-700"
        >
          <li
            v-for="(line, i) in selected.lines"
            :key="i"
            class="flex items-start justify-between gap-2 py-1.5"
          >
            <p class="min-w-0 truncate">
              <span class="font-medium text-neutral-900">{{ lineText(line).qty }}×</span>
              {{ lineText(line).description }}
            </p>
            <span v-if="lineText(line).sku" class="shrink-0 font-mono text-[11px] text-neutral-400">
              {{ lineText(line).sku }}
            </span>
          </li>
        </ul>
      </section>

      <UButton
        variant="soft"
        size="sm"
        icon="i-lucide-package-search"
        block
        @click="viewFulfilment(selected.fulfilmentId)"
      >
        View fulfilment
      </UButton>
    </InspectorPanel>
  </div>
</template>
