<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { PickDto } from '@fulfil-go/shared';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import { fmtDateTime as fmt } from '../lib/format.js';
import PageHeader from '../components/PageHeader.vue';
import FilterBar from '../components/table/FilterBar.vue';
import SortableTh, { type SortState } from '../components/table/SortableTh.vue';
import TruncationFooter from '../components/table/TruncationFooter.vue';

/**
 * Back-office pick views — one component, two routes:
 *   /picking/picks/requested  (meta.pickStatus 'requested')  — waiting for a picker
 *   /picking/picks/active     (meta.pickStatus 'claimed')    — being picked right now
 */
interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
  city: string | null;
  region: string | null;
}

const route = useRoute();
const status = computed(() => (route.meta['pickStatus'] as 'requested' | 'claimed') ?? 'requested');
const isActiveView = computed(() => status.value === 'claimed');

// Reka UI (Nuxt UI's select) rejects empty-string item values — use a sentinel.
const ALL_STORES = '__all__';

const picks = ref<PickDto[]>([]);
const pickerNames = ref<Record<string, string>>({});
const stores = ref<StoreSummary[]>([]);
const storeFilter = persistedFilter<string>('picks-admin', 'store', ALL_STORES);
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
  () => slotRange.value !== 'all' || storeFilter.value !== ALL_STORES,
);
function clearFilters(): void {
  storeFilter.value = ALL_STORES;
  slotRange.value = 'all';
  customFrom.value = '';
  customTo.value = '';
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


const storeOptions = computed(() => [
  { label: 'All stores', value: ALL_STORES },
  ...stores.value.map((s) => ({ label: `${s.storeRef} · ${s.name}`, value: s.storeRef })),
]);
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
    const params = new URLSearchParams({ status: status.value, slotOrder: sort.value.dir });
    if (storeFilter.value !== ALL_STORES) params.set('store', storeFilter.value);
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

/** Light poll — the admin view doesn't hold an SSE store stream. */
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void loadStores();
  void load();
  timer = setInterval(() => void load(), 30_000);
});
onUnmounted(() => clearInterval(timer));
watch([clientId], () => {
  storeFilter.value = ALL_STORES;
  void loadStores();
  void load();
});
watch([status, storeFilter, slotRange, customFrom, customTo, sort], () => void load(), {
  deep: true,
});
</script>

<template>
  <div class="max-w-5xl p-6">
    <PageHeader
      :title="isActiveView ? 'Active picks' : 'Requested picks'"
      :subtitle="
        isActiveView
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
      :active-count="activeFilterCount"
      :has-active="hasActiveFilters"
      @clear="clearFilters"
    >
      <template #inline>
        <USelect v-model="storeFilter" :items="storeOptions" value-key="value" class="w-80" />
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
            <th v-if="isActiveView" class="px-3 py-2">Picker</th>
            <th v-if="isActiveView" class="px-3 py-2">Claimed</th>
            <th v-else class="px-3 py-2">Waiting since</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in picks" :key="p.id" class="border-t border-neutral-100">
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
            <td v-if="isActiveView" class="px-3 py-2">
              {{ (p.claimedBy && pickerNames[p.claimedBy]) || p.claimedBy || '—' }}
            </td>
            <td v-if="isActiveView" class="px-3 py-2 text-neutral-500">{{ fmt(p.claimedAt) }}</td>
            <td v-else class="px-3 py-2 text-neutral-500">{{ fmt(p.createdAt) }}</td>
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
  </div>
</template>
