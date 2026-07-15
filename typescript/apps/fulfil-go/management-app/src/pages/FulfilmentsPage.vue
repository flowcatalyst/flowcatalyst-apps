<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FulfilmentDto } from '@fulfil-go/shared';
import { api, clientId } from '../context.js';
import PageHeader from '../components/PageHeader.vue';

interface LogEntry {
  id: number;
  at: string;
  subjectType: string;
  subjectId: string;
  source: string;
  actor: string;
  category: string;
  message: string;
  data: unknown;
}

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
const log = ref<LogEntry[]>([]);
const cancelReason = ref('');
const cancelBusy = ref(false);
const stores = ref<StoreSummary[]>([]);
/** Multi-select store filter — a fulfilment matches when ANY part is at a selected store. */
const storeFilter = ref<string[]>([]);
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
const statusFilter = ref<string[]>([]);
const typeFilter = ref('all');
/** datetime-local values (local time) — sent as ISO. */
const slotFrom = ref('');
const slotTo = ref('');

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
const selected = computed(() => rows.value.find((f) => f.id === selectedId.value));

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams({ limit: '100' });
    if (storeFilter.value.length > 0) params.set('stores', storeFilter.value.join(','));
    if (statusFilter.value.length > 0) params.set('status', statusFilter.value.join(','));
    if (typeFilter.value !== 'all') params.set('type', typeFilter.value);
    if (slotFrom.value) params.set('slotFrom', new Date(slotFrom.value).toISOString());
    if (slotTo.value) params.set('slotTo', new Date(slotTo.value).toISOString());
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

async function loadLog(id: string): Promise<void> {
  log.value = [];
  const res = await api.json<{ entries: LogEntry[] }>(
    `/clients/${clientId.value}/fulfilments/${id}/activity-log`,
  );
  log.value = res.entries;
}

/** Row click just swaps the panel content — the panel never has to dismiss. */
function select(id: string): void {
  void router.replace({ query: { ...route.query, selected: id } });
}
function closePanel(): void {
  const { selected: _drop, ...rest } = route.query;
  void router.replace({ query: rest });
}

// Handover PINs (docs/handover-verification.md): revealed ON DEMAND only —
// the server writes a pin-viewed audit entry as part of the read, so the
// activity log refreshes right after to make the trail visible.
interface HandoverPins {
  deliveryPin: string | null;
  pickupPins: { partId: string; shortId: string; originRef: string; pin: string }[];
}
const pins = ref<HandoverPins | null>(null);
const pinsBusy = ref(false);

async function revealPins(): Promise<void> {
  if (!selected.value) return;
  if (pins.value) {
    pins.value = null;
    return;
  }
  pinsBusy.value = true;
  try {
    pins.value = await api.json<HandoverPins>(
      `/clients/${clientId.value}/fulfilments/${selected.value.id}/handover-pins`,
    );
    await loadLog(selected.value.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    pinsBusy.value = false;
  }
}

async function cancelSelected(): Promise<void> {
  if (!selected.value) return;
  cancelBusy.value = true;
  try {
    await api.json(`/clients/${clientId.value}/fulfilments/${selected.value.id}/cancel`, {
      method: 'POST',
      body: cancelReason.value ? { reason: cancelReason.value } : {},
    });
    cancelReason.value = '';
    await refresh();
    await loadLog(selected.value.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    cancelBusy.value = false;
  }
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
watch([storeFilter, statusFilter, typeFilter, slotFrom, slotTo], () => void refresh());
watch(selectedId, (id) => {
  pins.value = null; // never carry a reveal across rows
  if (id) void loadLog(id);
});

const destinationName = computed(() => {
  const dest = selected.value?.destination as { location?: { name?: string } } | undefined;
  return dest?.location?.name ?? '—';
});
const collectionPointRef = computed(() => {
  const dest = selected.value?.destination as { collectionPointRef?: string } | undefined;
  return dest?.collectionPointRef ?? '';
});
/** "store-001 · Store name · City" — the part's origin, ref first (the system-wide handle). */
function originSummary(origin: unknown): string {
  const o = origin as {
    ref?: string;
    name?: string;
    address?: { suburb?: string; city?: string };
  };
  const place = [o.address?.suburb, o.address?.city].filter(Boolean).join(', ');
  return [o.ref, o.name, place].filter(Boolean).join(' · ') || '—';
}
function lineSku(line: unknown): string {
  return (line as { sku?: string }).sku ?? '';
}
function noSubs(line: unknown): boolean {
  return (line as { allowSubstitutes?: boolean }).allowSubstitutes === false;
}

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

/** Part-level state machine colours (see shared PartStatus enum). */
const partStatusColor: Record<string, string> = {
  pending: 'bg-neutral-100 text-neutral-600',
  pick_requested: 'bg-brand-50 text-brand-700',
  picking: 'bg-amber-50 text-amber-700',
  picked: 'bg-emerald-50 text-emerald-700',
  short_picked: 'bg-orange-50 text-orange-700',
  ready: 'bg-emerald-50 text-emerald-700',
  handed_over: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-neutral-100 text-neutral-500',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
}
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
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <USelect
          v-model="storeFilter"
          multiple
          :items="storeOptions"
          value-key="value"
          placeholder="Filter by store(s)…"
          class="w-72"
        />
        <USelect
          v-model="statusFilter"
          multiple
          :items="STATUS_OPTIONS"
          value-key="value"
          placeholder="Status…"
          class="w-52"
        />
        <USelect v-model="typeFilter" :items="TYPE_OPTIONS" value-key="value" class="w-36" />
        <label class="flex items-center gap-1 text-xs text-neutral-500">
          Slot from
          <input
            v-model="slotFrom"
            type="datetime-local"
            class="rounded border border-neutral-200 px-2 py-1.5 text-sm"
          />
        </label>
        <label class="flex items-center gap-1 text-xs text-neutral-500">
          to
          <input
            v-model="slotTo"
            type="datetime-local"
            class="rounded border border-neutral-200 px-2 py-1.5 text-sm"
          />
        </label>
        <UButton
          v-if="
            storeFilter.length > 0 ||
            statusFilter.length > 0 ||
            typeFilter !== 'all' ||
            slotFrom ||
            slotTo
          "
          size="xs"
          color="neutral"
          variant="ghost"
          @click="
            storeFilter = [];
            statusFilter = [];
            typeFilter = 'all';
            slotFrom = '';
            slotTo = '';
          "
        >
          Clear filters
        </UButton>
      </div>
      <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />

      <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-neutral-50 text-left text-xs font-semibold text-navy-700">
              <th class="px-3 py-2">External ref</th>
              <th class="px-3 py-2">Type</th>
              <th class="px-3 py-2">Level</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Store(s)</th>
              <th class="px-3 py-2">Parts</th>
              <th class="px-3 py-2">Slot start</th>
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
    </section>

    <!-- Non-modal inspector panel (ui-guidelines.md): a layout column, not an
         overlay — clicking other rows swaps content without dismissing. -->
    <aside
      v-if="selected"
      class="flex w-[480px] shrink-0 flex-col border-l border-neutral-200 bg-white shadow-[-8px_0_32px_rgba(15,23,42,0.06)]"
    >
      <div class="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="truncate text-lg font-semibold text-navy-900">
              {{ selected.externalRef }}
            </h2>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
              :class="statusColor[selected.status] ?? 'text-neutral-600 bg-neutral-100'"
            >
              {{ selected.status }}
            </span>
          </div>
          <p class="truncate font-mono text-xs text-neutral-400">{{ selected.id }}</p>
        </div>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          aria-label="Close panel"
          @click="closePanel"
        />
      </div>

      <div class="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <span class="mb-0.5 block text-xs font-medium text-neutral-500">Type</span>
            <span class="text-neutral-800">{{ selected.type }}</span>
          </div>
          <div>
            <span class="mb-0.5 block text-xs font-medium text-neutral-500">Service level</span>
            <span class="text-neutral-800">{{ selected.serviceLevel }}</span>
          </div>
          <div class="col-span-2">
            <span class="mb-0.5 block text-xs font-medium text-neutral-500">Slot</span>
            <span class="text-neutral-800">
              {{ fmt(selected.slotStart) }} – {{ fmt(selected.slotEnd) }}
            </span>
          </div>
          <div class="col-span-2">
            <span class="mb-0.5 block text-xs font-medium text-neutral-500">Destination</span>
            <span class="text-neutral-800">{{ destinationName }}</span>
            <span v-if="selected.type === 'collect'" class="text-neutral-500">
              ({{ collectionPointRef }})
            </span>
          </div>
        </div>

        <section>
          <h3 class="mb-2 text-sm font-semibold text-navy-700">
            Parts ({{ selected.parts.length }})
          </h3>
          <div class="flex flex-col gap-3">
            <div
              v-for="part in selected.parts"
              :key="part.id"
              class="overflow-hidden rounded-lg border border-neutral-200"
            >
              <div
                class="flex items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2"
              >
                <div class="min-w-0">
                  <p class="font-mono text-sm font-semibold">#{{ part.shortId }}</p>
                  <p class="truncate text-xs text-neutral-500">{{ originSummary(part.origin) }}</p>
                </div>
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="partStatusColor[part.status] ?? 'bg-neutral-100 text-neutral-600'"
                >
                  {{ part.status }}
                </span>
              </div>
              <ul class="divide-y divide-neutral-100 px-3 text-xs text-neutral-700">
                <li
                  v-for="(line, i) in part.lines"
                  :key="i"
                  class="flex items-start justify-between gap-2 py-1.5"
                >
                  <div class="min-w-0">
                    <p class="truncate">
                      <span class="font-medium text-neutral-900">{{ line.quantity }}×</span>
                      {{ line.description }}
                    </p>
                    <p v-if="lineSku(line)" class="font-mono text-[11px] text-neutral-400">
                      {{ lineSku(line) }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <span
                      v-if="noSubs(line)"
                      class="rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700"
                    >
                      no subs
                    </span>
                    <span
                      v-if="line.temperatureClass && line.temperatureClass !== 'ambient'"
                      class="rounded px-1 py-0.5 text-[10px] font-medium"
                      :class="
                        line.temperatureClass === 'frozen'
                          ? 'bg-cyan-50 text-cyan-700'
                          : 'bg-sky-50 text-sky-700'
                      "
                    >
                      {{ line.temperatureClass }}
                    </span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-navy-700">
              Handover PINs
              <span
                v-if="selected.maxRestrictedAge"
                class="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
              >
                🔞 {{ selected.maxRestrictedAge }}+
              </span>
            </h3>
            <UButton size="xs" variant="soft" :loading="pinsBusy" @click="revealPins">
              {{ pins ? 'Hide' : 'Reveal (audited)' }}
            </UButton>
          </div>
          <div v-if="pins" class="rounded-lg bg-neutral-50 p-2 text-sm">
            <p v-if="pins.deliveryPin" class="flex items-baseline justify-between">
              <span class="text-neutral-500">Delivery (customer)</span>
              <span class="font-mono text-lg font-bold tracking-widest">{{
                pins.deliveryPin
              }}</span>
            </p>
            <p
              v-for="p in pins.pickupPins"
              :key="p.partId"
              class="flex items-baseline justify-between"
            >
              <span class="text-neutral-500">Pickup #{{ p.shortId }} ({{ p.originRef }})</span>
              <span class="font-mono text-lg font-bold tracking-widest">{{ p.pin }}</span>
            </p>
            <p
              v-if="!pins.deliveryPin && pins.pickupPins.length === 0"
              class="text-xs text-neutral-400"
            >
              No pins on this fulfilment (created before PINs or policy off).
            </p>
          </div>
        </section>

        <section v-if="selected.status === 'created'" class="flex flex-col gap-2">
          <UTextarea
            v-model="cancelReason"
            placeholder="Cancellation reason (optional)"
            :rows="2"
          />
          <UButton color="error" variant="soft" block :loading="cancelBusy" @click="cancelSelected">
            Cancel fulfilment
          </UButton>
        </section>

        <section>
          <h3 class="mb-1 text-sm font-semibold text-navy-700">Activity log</h3>
          <ol class="flex flex-col gap-1 text-xs">
            <li v-for="entry in log" :key="entry.id" class="rounded bg-neutral-50 px-2 py-1">
              <span class="text-neutral-400">{{ fmt(entry.at) }}</span>
              <span
                v-if="entry.source !== 'domain'"
                class="ml-1 rounded bg-neutral-200 px-1 text-[10px] uppercase tracking-wide text-neutral-500"
                >{{ entry.source }}</span
              >
              · {{ entry.message }}
            </li>
          </ol>
        </section>
      </div>
    </aside>
  </div>
</template>
