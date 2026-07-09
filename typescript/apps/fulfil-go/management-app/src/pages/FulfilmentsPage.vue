<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FulfilmentDto } from '@fulfil-go/shared';
import { api, clientId } from '../context.js';

interface LogEntry {
  id: number;
  at: string;
  actor: string;
  category: string;
  message: string;
  data: unknown;
}

const route = useRoute();
const router = useRouter();
const rows = ref<FulfilmentDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const log = ref<LogEntry[]>([]);
const cancelReason = ref('');
const cancelBusy = ref(false);

/** Panel selection lives in the route query — deep links + back/forward work. */
const selectedId = computed(() => (route.query['selected'] as string | undefined) ?? null);
const selected = computed(() => rows.value.find((f) => f.id === selectedId.value));

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.json<{ fulfilments: FulfilmentDto[] }>(
      `/clients/${clientId.value}/fulfilments?limit=100`,
    );
    rows.value = res.fulfilments;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function loadLog(id: string): Promise<void> {
  log.value = [];
  const res = await api.json<{ entries: LogEntry[] }>(
    `/clients/${clientId.value}/fulfilments/${id}/processing-log`,
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

onMounted(() => void refresh());
watch(clientId, () => {
  closePanel();
  void refresh();
});
watch(selectedId, (id) => {
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
/** "Store name · Suburb, City" — the part's origin at a glance. */
function originSummary(origin: unknown): string {
  const o = origin as { name?: string; address?: { suburb?: string; city?: string } };
  const place = [o.address?.suburb, o.address?.city].filter(Boolean).join(', ');
  return place ? `${o.name ?? '—'} · ${place}` : (o.name ?? '—');
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
    <section class="min-w-0 flex-1 overflow-y-auto p-4">
      <div class="mb-3 flex items-center justify-between">
        <h1 class="text-xl font-semibold text-[#102a43]">Fulfilments</h1>
        <UButton size="sm" variant="soft" :loading="loading" @click="refresh">Refresh</UButton>
      </div>
      <UAlert v-if="error" :description="error" color="error" variant="soft" class="mb-3" />

      <div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-neutral-50 text-left text-xs font-semibold text-[#334e68]">
              <th class="px-3 py-2">External ref</th>
              <th class="px-3 py-2">Type</th>
              <th class="px-3 py-2">Level</th>
              <th class="px-3 py-2">Status</th>
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
                {{ f.parts.map((p) => `#${p.shortId}`).join(', ') }}
              </td>
              <td class="px-3 py-2 text-neutral-500">{{ fmt(f.slotStart) }}</td>
            </tr>
            <tr v-if="rows.length === 0 && !loading">
              <td colspan="6" class="px-3 py-8 text-center text-neutral-400">
                No fulfilments for {{ clientId }} — try the Generator.
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
      class="flex w-[420px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-200 bg-white p-4"
    >
      <div class="flex items-start justify-between">
        <div class="min-w-0">
          <h2 class="truncate font-mono text-sm text-neutral-500">{{ selected.id }}</h2>
          <p class="text-lg font-semibold">{{ selected.externalRef }}</p>
        </div>
        <UButton size="xs" color="neutral" variant="ghost" @click="closePanel">✕</UButton>
      </div>

      <div class="grid grid-cols-2 gap-2 text-sm">
        <div><span class="text-neutral-500">Type</span><br />{{ selected.type }}</div>
        <div><span class="text-neutral-500">Level</span><br />{{ selected.serviceLevel }}</div>
        <div><span class="text-neutral-500">Status</span><br />{{ selected.status }}</div>
        <div>
          <span class="text-neutral-500">Slot</span><br />{{ fmt(selected.slotStart) }} –
          {{ fmt(selected.slotEnd) }}
        </div>
        <div class="col-span-2">
          <span class="text-neutral-500">Destination</span><br />
          {{ destinationName }}
          <span v-if="selected.type === 'collect'" class="text-neutral-500">
            ({{ collectionPointRef }})
          </span>
        </div>
      </div>

      <section>
        <h3 class="mb-2 text-sm font-semibold text-[#334e68]">
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
                    v-if="line.temperatureClass && line.temperatureClass !== 'normal'"
                    class="rounded px-1 py-0.5 text-[10px] font-medium"
                    :class="line.temperatureClass === 'frozen'
                      ? 'bg-cyan-50 text-cyan-700'
                      : 'bg-sky-50 text-sky-700'"
                  >
                    {{ line.temperatureClass }}
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section v-if="selected.status === 'created'" class="flex flex-col gap-2">
        <UTextarea v-model="cancelReason" placeholder="Cancellation reason (optional)" :rows="2" />
        <UButton color="error" variant="soft" block :loading="cancelBusy" @click="cancelSelected">
          Cancel fulfilment
        </UButton>
      </section>

      <section>
        <h3 class="mb-1 text-sm font-semibold text-[#334e68]">Processing log</h3>
        <ol class="flex flex-col gap-1 text-xs">
          <li v-for="entry in log" :key="entry.id" class="rounded bg-neutral-50 px-2 py-1">
            <span class="text-neutral-400">{{ fmt(entry.at) }}</span> · {{ entry.message }}
          </li>
        </ol>
      </section>
    </aside>
  </div>
</template>
