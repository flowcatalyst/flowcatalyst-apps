<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { FulfilmentDto } from '@fulfil-go/shared';
import { api, clientId } from '../context.js';
import { fmtDateTime as fmt } from '../lib/format.js';
import InspectorPanel from './InspectorPanel.vue';

/**
 * The fulfilment inspector — the 480px non-modal side panel, extracted from
 * FulfilmentsPage so any page (Fulfilments grid, Flightboard) can dock it.
 * Self-sufficient: fetches the fulfilment BY ID (so deep links work even
 * when the host grid's filtered page doesn't contain the row), plus its
 * activity log, pick links, and audited handover-PIN reveal.
 */
const props = defineProps<{ fulfilmentId: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const router = useRouter();

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
interface HandoverPins {
  deliveryPin: string | null;
  pickupPins: { partId: string; shortId: string; originRef: string; pin: string }[];
}
interface PickLink {
  id: string;
  partId: string;
  shortId: string;
  status: string;
}

const fulfilment = ref<FulfilmentDto | null>(null);
const log = ref<LogEntry[]>([]);
const pickByPart = ref<Record<string, PickLink>>({});
const pins = ref<HandoverPins | null>(null);
const pinsBusy = ref(false);
const cancelReason = ref('');
const cancelBusy = ref(false);
const error = ref<string | null>(null);

async function loadFulfilment(): Promise<void> {
  fulfilment.value = await api.json<FulfilmentDto>(
    `/clients/${clientId.value}/fulfilments/${props.fulfilmentId}`,
  );
}

async function loadLog(): Promise<void> {
  const res = await api.json<{ entries: LogEntry[] }>(
    `/clients/${clientId.value}/fulfilments/${props.fulfilmentId}/activity-log`,
  );
  log.value = res.entries;
}

async function loadPicks(): Promise<void> {
  try {
    const res = await api.json<{ picks: PickLink[] }>(
      `/clients/${clientId.value}/fulfilments/${props.fulfilmentId}/picks`,
    );
    pickByPart.value = Object.fromEntries(res.picks.map((p) => [p.partId, p]));
  } catch {
    pickByPart.value = {}; // best-effort enrichment
  }
}

async function loadAll(): Promise<void> {
  error.value = null;
  pins.value = null; // never carry a reveal across rows
  log.value = [];
  pickByPart.value = {};
  try {
    await Promise.all([loadFulfilment(), loadLog(), loadPicks()]);
  } catch (err) {
    fulfilment.value = null;
    error.value = err instanceof Error ? err.message : String(err);
  }
}
watch(() => props.fulfilmentId, () => void loadAll(), { immediate: true });

// Handover PINs (docs/handover-verification.md): revealed ON DEMAND only —
// the server writes a pin-viewed audit entry as part of the read, so the
// activity log refreshes right after to make the trail visible.
async function revealPins(): Promise<void> {
  if (pins.value) {
    pins.value = null;
    return;
  }
  pinsBusy.value = true;
  try {
    pins.value = await api.json<HandoverPins>(
      `/clients/${clientId.value}/fulfilments/${props.fulfilmentId}/handover-pins`,
    );
    await loadLog();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    pinsBusy.value = false;
  }
}

async function cancelFulfilment(): Promise<void> {
  cancelBusy.value = true;
  try {
    await api.json(`/clients/${clientId.value}/fulfilments/${props.fulfilmentId}/cancel`, {
      method: 'POST',
      body: cancelReason.value ? { reason: cancelReason.value } : {},
    });
    cancelReason.value = '';
    await loadAll();
    emit('changed');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    cancelBusy.value = false;
  }
}

function viewPick(pickId: string): void {
  void router.push({ path: '/picking/picks/enquiry', query: { selected: pickId } });
}

const destinationName = computed(() => {
  const dest = fulfilment.value?.destination as { location?: { name?: string } } | undefined;
  return dest?.location?.name ?? '—';
});
const collectionPointRef = computed(() => {
  const dest = fulfilment.value?.destination as { collectionPointRef?: string } | undefined;
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
</script>

<template>
  <InspectorPanel
    :title="fulfilment?.externalRef ?? 'Fulfilment'"
    :subtitle="fulfilmentId"
    :status="fulfilment?.status"
    :status-tone="fulfilment ? statusColor[fulfilment.status] : undefined"
    @close="emit('close')"
  >
    <UAlert v-if="error" :description="error" color="error" variant="soft" />

    <template v-if="fulfilment">
      <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Type</span>
          <span class="text-neutral-800">{{ fulfilment.type }}</span>
        </div>
        <div>
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Service level</span>
          <span class="text-neutral-800">{{ fulfilment.serviceLevel }}</span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Slot</span>
          <span class="text-neutral-800">
            {{ fmt(fulfilment.slotStart) }} – {{ fmt(fulfilment.slotEnd) }}
          </span>
        </div>
        <div class="col-span-2">
          <span class="mb-0.5 block text-xs font-medium text-neutral-500">Destination</span>
          <span class="text-neutral-800">{{ destinationName }}</span>
          <span v-if="fulfilment.type === 'collect'" class="text-neutral-500">
            ({{ collectionPointRef }})
          </span>
        </div>
      </div>

      <section>
        <h3 class="mb-2 text-sm font-semibold text-navy-700">
          Parts ({{ fulfilment.parts.length }})
        </h3>
        <div class="flex flex-col gap-3">
          <div
            v-for="part in fulfilment.parts"
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
              <div class="flex shrink-0 items-center gap-1.5">
                <button
                  v-if="pickByPart[part.id]"
                  type="button"
                  class="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                  :title="`Pick ${pickByPart[part.id]!.status} — open in Pick enquiry`"
                  @click="viewPick(pickByPart[part.id]!.id)"
                >
                  <UIcon name="i-lucide-shopping-cart" class="size-3" />
                  pick: {{ pickByPart[part.id]!.status }}
                </button>
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="partStatusColor[part.status] ?? 'bg-neutral-100 text-neutral-600'"
                >
                  {{ part.status }}
                </span>
              </div>
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
              v-if="fulfilment.maxRestrictedAge"
              class="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
            >
              🔞 {{ fulfilment.maxRestrictedAge }}+
            </span>
          </h3>
          <UButton size="xs" variant="soft" :loading="pinsBusy" @click="revealPins">
            {{ pins ? 'Hide' : 'Reveal (audited)' }}
          </UButton>
        </div>
        <div v-if="pins" class="rounded-lg bg-neutral-50 p-2 text-sm">
          <p v-if="pins.deliveryPin" class="flex items-baseline justify-between">
            <span class="text-neutral-500">Delivery (customer)</span>
            <span class="font-mono text-lg font-bold tracking-widest">{{ pins.deliveryPin }}</span>
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

      <section v-if="fulfilment.status === 'created'" class="flex flex-col gap-2">
        <UTextarea v-model="cancelReason" placeholder="Cancellation reason (optional)" :rows="2" />
        <UButton
          color="error"
          variant="soft"
          block
          :loading="cancelBusy"
          @click="cancelFulfilment"
        >
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
    </template>
  </InspectorPanel>
</template>
