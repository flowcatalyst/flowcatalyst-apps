<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FulfilmentDto } from '@fulfil-go/shared';
import { api, clientId } from '../context.js';
import { persistedFilter } from '../lib/persisted-filter.js';
import { fmtDateTime as fmt } from '../lib/format.js';
import PageHeader from '../components/PageHeader.vue';
import FulfilmentInspector from '../components/FulfilmentInspector.vue';
import FilterBar from '../components/table/FilterBar.vue';
import SortableTh, { type SortState } from '../components/table/SortableTh.vue';
import TruncationFooter from '../components/table/TruncationFooter.vue';

interface StoreSummary {
  id: string;
  storeRef: string;
  name: string;
  city: string | null;
  region: string | null;
}

const route = useRoute();
const router = useRouter();
const rows = ref<FulfilmentDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const stores = ref<StoreSummary[]>([]);
/** Multi-select store filter — a fulfilment matches when ANY part is at a selected store. */
const storeFilter = persistedFilter<string[]>('fulfilments', 'stores', []);
// Server-side filters (Andrew, 2026-07-15): status, type, slot range.
const STATUS_OPTIONS = [
  'created',
  'in_progress',
  'ready',
  'completing',
  'completed',
  'partially_completed',
  'failed',
  'cancelling',
  'cancelled',
].map((s) => ({ label: s.replaceAll('_', ' '), value: s }));
// Reka-ui (Nuxt UI 4.9+) forbids '' as a SelectItem value — 'all' is the
// no-filter sentinel (the StoreProfilesPage 'inherit' pattern).
const TYPE_OPTIONS = [
  { label: 'All types', value: 'all' },
  { label: 'Delivery', value: 'delivery' },
  { label: 'Collect', value: 'collect' },
];
const statusFilter = persistedFilter<string[]>('fulfilments', 'statuses', []);
const typeFilter = persistedFilter('fulfilments', 'type', 'all');
/** datetime-local values (local time) — sent as ISO. */
const slotFrom = persistedFilter('fulfilments', 'slotFrom', '');
const slotTo = persistedFilter('fulfilments', 'slotTo', '');
/** Server-side quick-search: externalRef contains OR part shortId prefix. */
const search = persistedFilter('fulfilments', 'q', '');
const sort = persistedFilter<SortState>('fulfilments', 'sort', {
  field: 'createdAt',
  dir: 'desc',
});

/** Rows requested per load — hitting it renders the truncation notice. */
const LIMIT = 100;

/** Popover-filter count for the FilterBar badge (store select is inline). */
const activeFilterCount = computed(
  () =>
    (statusFilter.value.length > 0 ? 1 : 0) +
    (typeFilter.value !== 'all' ? 1 : 0) +
    (slotFrom.value || slotTo.value ? 1 : 0),
);
const hasActiveFilters = computed(
  () =>
    activeFilterCount.value > 0 || storeFilter.value.length > 0 || search.value.trim().length > 0,
);
function clearFilters(): void {
  storeFilter.value = [];
  statusFilter.value = [];
  typeFilter.value = 'all';
  slotFrom.value = '';
  slotTo.value = '';
  search.value = '';
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
    stores.value = []; // registry empty/unreachable — filter just stays empty
  }
}

/** Panel selection lives in the route query — deep links + back/forward work. */
const selectedId = computed(() => (route.query['selected'] as string | undefined) ?? null);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams({
      limit: String(LIMIT),
      sort: sort.value.field,
      dir: sort.value.dir,
    });
    if (storeFilter.value.length > 0) params.set('stores', storeFilter.value.join(','));
    if (statusFilter.value.length > 0) params.set('status', statusFilter.value.join(','));
    if (typeFilter.value !== 'all') params.set('type', typeFilter.value);
    if (slotFrom.value) params.set('slotFrom', new Date(slotFrom.value).toISOString());
    if (slotTo.value) params.set('slotTo', new Date(slotTo.value).toISOString());
    if (search.value.trim()) params.set('q', search.value.trim());
    const res = await api.json<{ fulfilments: FulfilmentDto[] }>(
      `/clients/${clientId.value}/fulfilments?${params.toString()}`,
    );
    rows.value = res.fulfilments;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

/** Distinct part origin refs for the grid's Store(s) column. */
function fulfilmentStores(f: FulfilmentDto): string[] {
  return [...new Set(f.parts.map((p) => (p.origin as { ref?: string }).ref ?? '?'))];
}

/** Row click just swaps the panel content — the panel never has to dismiss. */
function select(id: string): void {
  void router.replace({ query: { ...route.query, selected: id } });
}
function closePanel(): void {
  const { selected: _drop, ...rest } = route.query;
  void router.replace({ query: rest });
}

onMounted(() => {
  void loadStores();
  void refresh();
});
watch(clientId, () => {
  closePanel();
  storeFilter.value = [];
  void loadStores();
  void refresh();
});
watch([storeFilter, statusFilter, typeFilter, slotFrom, slotTo, sort], () => void refresh(), {
  deep: true,
});
// Debounce the server-side quick-search so typing doesn't fire per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void refresh(), 300);
});

const statusColor: Record<string, string> = {
  created: 'text-brand-600 bg-brand-50',
  in_progress: 'text-amber-700 bg-amber-50',
  ready: 'text-emerald-700 bg-emerald-50',
  completing: 'text-emerald-700 bg-emerald-50',
  completed: 'text-emerald-700 bg-emerald-50',
  partially_completed: 'text-orange-700 bg-orange-50',
  cancelling: 'text-neutral-500 bg-neutral-100',
  cancelled: 'text-neutral-500 bg-neutral-100',
  failed: 'text-red-700 bg-red-50',
};


</script>

<template>
  <div class="flex h-full">
    <!-- Grid stays fully interactive while the panel is open. -->
    <section class="min-w-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        title="Fulfilments"
        subtitle="Every fulfilment for the active client, parts and all."
      >
        <template #actions>
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
      <FilterBar
        v-model:search="search"
        show-search
        search-placeholder="Search ref or part #…"
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
            placeholder="Filter by store(s)…"
            class="w-72"
          />
        </template>
        <template #filters>
          <div>
            <label class="mb-1 block text-xs font-medium text-neutral-500">Status</label>
            <USelect
              v-model="statusFilter"
              multiple
              :items="STATUS_OPTIONS"
              value-key="value"
              placeholder="Any status"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-neutral-500">Type</label>
            <USelect
              v-model="typeFilter"
              :items="TYPE_OPTIONS"
              value-key="value"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-neutral-500">Slot window</label>
            <div class="flex items-center gap-2">
              <UInput v-model="slotFrom" type="datetime-local" size="sm" aria-label="Slot from" />
              <span class="text-xs text-neutral-400">to</span>
              <UInput v-model="slotTo" type="datetime-local" size="sm" aria-label="Slot to" />
            </div>
          </div>
        </template>
        <template #meta>{{ rows.length }} fulfilment(s)</template>
      </FilterBar>
      <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />

      <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
              <th class="px-3 py-2">External ref</th>
              <th class="px-3 py-2">Type</th>
              <th class="px-3 py-2">Level</th>
              <SortableTh v-model="sort" field="status" label="Status" />
              <th class="px-3 py-2">Store(s)</th>
              <th class="px-3 py-2">Parts</th>
              <SortableTh v-model="sort" field="slotStart" label="Slot start" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="f in rows"
              :key="f.id"
              class="cursor-pointer border-t border-neutral-100 hover:bg-brand-50/50"
              :class="{ 'bg-brand-50': f.id === selectedId }"
              @click="select(f.id)"
            >
              <td class="px-3 py-2 font-mono text-xs">{{ f.externalRef }}</td>
              <td class="px-3 py-2">{{ f.type }}</td>
              <td class="px-3 py-2">{{ f.serviceLevel }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="statusColor[f.status] ?? 'text-neutral-600 bg-neutral-100'"
                >
                  {{ f.status }}
                </span>
              </td>
              <td class="px-3 py-2">
                <span
                  v-for="ref in fulfilmentStores(f)"
                  :key="ref"
                  class="mr-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs"
                  :title="storeNames.get(ref) ?? ref"
                >
                  {{ ref }}
                </span>
              </td>
              <td class="px-3 py-2">
                {{ f.parts.map((p) => `#${p.shortId}`).join(', ') }}
              </td>
              <td class="px-3 py-2 text-neutral-500">{{ fmt(f.slotStart) }}</td>
            </tr>
            <tr v-if="rows.length === 0 && !loading">
              <td colspan="7" class="px-3 py-8 text-center text-neutral-400">
                {{
                  storeFilter.length > 0
                    ? 'No fulfilments with parts at the selected store(s).'
                    : `No fulfilments for ${clientId} — try the Generator.`
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <TruncationFooter :shown="rows.length" :limit="LIMIT" />
    </section>

    <!-- Non-modal inspector (shared component — fetches by id, so deep
         links resolve even when the filtered page lacks the row). -->
    <FulfilmentInspector
      v-if="selectedId"
      :fulfilment-id="selectedId"
      @close="closePanel"
      @changed="refresh"
    />
  </div>
</template>
