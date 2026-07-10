<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useRoute, useRouter } from 'vue-router';
import type { PickDto } from '@fulfil-go/shared';
import { useAppCtx } from '../context.js';

/**
 * Pick-then-pack workflow (one order at a time — see docs/picking-workflow.md).
 *
 * Stage PICK: count each line (tap or scan). Short totals are only allowed
 * through when the pick doesn't require a full pick (`requireFullPick` = the
 * fulfilment forbade partial fulfilment) — otherwise the only out is Fail.
 *
 * Stage PACK, two sub-modes (all-or-none per completion, server-enforced):
 *  - items: scan/assign every picked unit into a bag/loose package — contents
 *    fully known downstream.
 *  - bags:  just register bag barcodes + size + type (+ loose markers).
 */
const ctx = useAppCtx();
const route = useRoute();
const router = useRouter();

const pickId = computed(() => route.params['pickId'] as string);
const pick = computed<PickDto | undefined>(() => ctx.picks.byId(pickId.value));

const stage = ref<'pick' | 'pack'>('pick');
/** externalLineRef → counted quantity (stage PICK). */
const counts = reactive<Record<string, number>>({});
const busy = ref(false);
const error = ref<string | null>(null);
const failMode = ref(false);
const failReason = ref('');
const isNative = Capacitor.isNativePlatform();
const scanBusy = ref(false);

// ── Packing state ─────────────────────────────────────────────────────────
type PackMode = 'items' | 'bags';
const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
const TEMPS = [
  { value: 'ambient', label: 'Standard' },
  { value: 'refrigerated', label: 'Fridge' },
  { value: 'frozen', label: 'Freezer' },
] as const;

interface PackagedUnit {
  ref: string;
  kind: 'bag' | 'loose';
  size: (typeof SIZES)[number] | null;
  temperature: (typeof TEMPS)[number]['value'];
  /** externalLineRef → quantity (items sub-mode only). */
  items: Record<string, number>;
}

const packMode = ref<PackMode>('items');
const packages = ref<PackagedUnit[]>([]);
const activeRef = ref<string | null>(null);
const bagForm = reactive({
  ref: '',
  size: null as (typeof SIZES)[number] | null,
  temperature: 'ambient' as (typeof TEMPS)[number]['value'],
});
let looseSeq = 0;

watch(
  pick,
  (p) => {
    if (!p) return;
    for (const line of p.lines as { externalLineRef: string }[]) {
      counts[line.externalLineRef] ??= 0;
    }
  },
  { immediate: true },
);

type Line = {
  externalLineRef: string;
  sku: string;
  gtin?: string;
  description: string;
  quantity: number;
  temperatureClass?: string;
};
const lines = computed(() => (pick.value?.lines ?? []) as Line[]);

// ── Stage PICK helpers ────────────────────────────────────────────────────
function bump(line: Line, delta: number): void {
  const next = (counts[line.externalLineRef] ?? 0) + delta;
  counts[line.externalLineRef] = Math.min(Math.max(next, 0), line.quantity);
}
function fillLine(line: Line): void {
  counts[line.externalLineRef] = line.quantity;
}
function fillAll(): void {
  for (const line of lines.value) fillLine(line);
}

const totalOrdered = computed(() => lines.value.reduce((s, l) => s + l.quantity, 0));
const totalCounted = computed(() =>
  lines.value.reduce((s, l) => s + (counts[l.externalLineRef] ?? 0), 0),
);
const isShort = computed(() => totalCounted.value < totalOrdered.value);
const shortBlocked = computed(() => isShort.value && pick.value?.requireFullPick === true);

async function scanBarcode(): Promise<string | null> {
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
  const { camera } = await BarcodeScanner.requestPermissions();
  if (camera !== 'granted' && camera !== 'limited') throw new Error('camera permission denied');
  const { barcodes } = await BarcodeScanner.scan();
  return barcodes[0]?.rawValue ?? null;
}

/** Stage PICK: scan an item barcode → +1 on the matching line. */
async function scanItem(): Promise<void> {
  scanBusy.value = true;
  error.value = null;
  try {
    const code = await scanBarcode();
    if (!code) return;
    const line = lines.value.find((l) => l.gtin === code || l.sku === code);
    if (!line) {
      error.value = `No line matches barcode '${code}'.`;
      return;
    }
    if (stage.value === 'pick') bump(line, 1);
    else assign(line, 1); // stage PACK, items mode: into the active package
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    scanBusy.value = false;
  }
}

// ── Stage PACK helpers ────────────────────────────────────────────────────
const assignedPerLine = computed(() => {
  const totals: Record<string, number> = {};
  for (const pkg of packages.value) {
    for (const [lineRef, qty] of Object.entries(pkg.items)) {
      totals[lineRef] = (totals[lineRef] ?? 0) + qty;
    }
  }
  return totals;
});
const unassignedTotal = computed(() =>
  lines.value.reduce(
    (s, l) => s + ((counts[l.externalLineRef] ?? 0) - (assignedPerLine.value[l.externalLineRef] ?? 0)),
    0,
  ),
);
const activePackage = computed(() => packages.value.find((p) => p.ref === activeRef.value));

function switchMode(mode: PackMode): void {
  if (packages.value.length > 0) return; // locked once packing started
  packMode.value = mode;
}

async function scanBagRef(): Promise<void> {
  scanBusy.value = true;
  error.value = null;
  try {
    const code = await scanBarcode();
    if (code) bagForm.ref = code;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    scanBusy.value = false;
  }
}

function addBag(): void {
  error.value = null;
  const bagRef = bagForm.ref.trim();
  if (!bagRef || !bagForm.size) return;
  if (packages.value.some((p) => p.ref === bagRef)) {
    error.value = `Bag '${bagRef}' is already added.`;
    return;
  }
  packages.value.push({
    ref: bagRef,
    kind: 'bag',
    size: bagForm.size,
    temperature: bagForm.temperature,
    items: {},
  });
  activeRef.value = bagRef;
  bagForm.ref = '';
  bagForm.size = null;
  bagForm.temperature = 'ambient';
}

function addLoose(): void {
  looseSeq += 1;
  const looseRef = `loose-${looseSeq}`;
  packages.value.push({ ref: looseRef, kind: 'loose', size: null, temperature: 'ambient', items: {} });
  activeRef.value = looseRef;
}

function removePackage(pkgRef: string): void {
  packages.value = packages.value.filter((p) => p.ref !== pkgRef);
  if (activeRef.value === pkgRef) activeRef.value = packages.value[0]?.ref ?? null;
}

/** items sub-mode: move units of a line into/out of the ACTIVE package. */
function assign(line: Line, delta: number): void {
  const pkg = activePackage.value;
  if (!pkg) {
    error.value = 'Add or select a bag first.';
    return;
  }
  const inPkg = pkg.items[line.externalLineRef] ?? 0;
  const picked = counts[line.externalLineRef] ?? 0;
  const assignedElsewhere = (assignedPerLine.value[line.externalLineRef] ?? 0) - inPkg;
  const next = Math.min(Math.max(inPkg + delta, 0), picked - assignedElsewhere);
  if (next === 0) delete pkg.items[line.externalLineRef];
  else pkg.items[line.externalLineRef] = next;
}

const canComplete = computed(() => {
  if (packages.value.length === 0) return false;
  if (packMode.value === 'items') return unassignedTotal.value === 0;
  return true;
});

// ── Actions ───────────────────────────────────────────────────────────────
async function complete(): Promise<void> {
  if (!pick.value) return;
  busy.value = true;
  error.value = null;
  try {
    await ctx.api.json(`/clients/${ctx.station.clientId.value}/picks/${pick.value.id}/complete`, {
      method: 'POST',
      body: {
        lines: lines.value.map((l) => ({
          externalLineRef: l.externalLineRef,
          pickedQuantity: counts[l.externalLineRef] ?? 0,
        })),
        packages: packages.value.map((p) => ({
          ref: p.ref,
          kind: p.kind,
          ...(p.size ? { size: p.size } : {}),
          temperature: p.temperature,
          ...(packMode.value === 'items'
            ? {
                items: Object.entries(p.items).map(([externalLineRef, quantity]) => ({
                  externalLineRef,
                  quantity,
                })),
              }
            : {}),
        })),
      },
    });
    await ctx.picks.hydrate();
    await router.push('/picks');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function fail(): Promise<void> {
  if (!pick.value || !failReason.value.trim()) return;
  busy.value = true;
  error.value = null;
  try {
    await ctx.api.json(`/clients/${ctx.station.clientId.value}/picks/${pick.value.id}/fail`, {
      method: 'POST',
      body: { reason: failReason.value.trim() },
    });
    await ctx.picks.hydrate();
    await router.push('/picks');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="!pick" class="p-6 text-center text-neutral-400">
    Pick not found — it may have been completed elsewhere.
  </div>
  <div v-else class="flex flex-col gap-4 p-4 pb-8">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <p class="font-mono text-2xl font-semibold">#{{ pick.shortId }}</p>
        <p class="text-xs text-neutral-500">
          {{ stage === 'pick' ? 'Picking' : 'Packing' }} · {{ totalCounted }}/{{ totalOrdered }}
          units
          <template v-if="stage === 'pack' && packMode === 'items'">
            · {{ unassignedTotal }} to pack
          </template>
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <span
          v-if="pick.serviceLevel === 'ASAP'"
          class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
        >
          ASAP
        </span>
        <span
          v-if="pick.requireFullPick"
          class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
          title="The fulfilment does not allow partial fulfilment"
        >
          FULL PICK REQUIRED
        </span>
      </div>
    </div>

    <UAlert v-if="error" :description="error" color="error" variant="soft" />

    <!-- ════ STAGE: PICK ════ -->
    <template v-if="stage === 'pick'">
      <div class="flex gap-2">
        <UButton v-if="isNative" variant="soft" :loading="scanBusy" @click="scanItem">
          📷 Scan item
        </UButton>
        <UButton variant="ghost" size="sm" @click="fillAll">Mark all picked</UButton>
      </div>

      <UCard v-for="line in lines" :key="line.externalLineRef">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-medium">{{ line.description }}</p>
            <p class="font-mono text-[11px] text-neutral-400">{{ line.sku }}</p>
            <span
              v-if="line.temperatureClass && line.temperatureClass !== 'normal'"
              class="text-xs text-cyan-600"
            >
              {{ line.temperatureClass }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <UButton
              size="lg"
              color="neutral"
              variant="soft"
              :disabled="(counts[line.externalLineRef] ?? 0) === 0"
              @click="bump(line, -1)"
            >
              −
            </UButton>
            <button
              class="min-w-14 text-center font-mono text-lg"
              :class="
                (counts[line.externalLineRef] ?? 0) === line.quantity
                  ? 'text-emerald-600 font-semibold'
                  : ''
              "
              title="Tap to mark line fully picked"
              @click="fillLine(line)"
            >
              {{ counts[line.externalLineRef] ?? 0 }}/{{ line.quantity }}
            </button>
            <UButton
              size="lg"
              variant="soft"
              :disabled="(counts[line.externalLineRef] ?? 0) >= line.quantity"
              @click="bump(line, 1)"
            >
              +
            </UButton>
          </div>
        </div>
      </UCard>

      <UAlert
        v-if="shortBlocked"
        title="Full pick required"
        description="This fulfilment doesn't allow partial fulfilment — pick every line in full, or
          fail the pick if items are unavailable."
        color="warning"
        variant="soft"
      />

      <UButton
        size="xl"
        block
        :disabled="shortBlocked || totalCounted === 0"
        @click="stage = 'pack'"
      >
        Continue to packing {{ isShort ? `(short: ${totalCounted}/${totalOrdered})` : '' }}
      </UButton>
    </template>

    <!-- ════ STAGE: PACK ════ -->
    <template v-else>
      <!-- Sub-mode toggle (locked once packages exist) -->
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="m in [
            { value: 'items', label: 'Scan items into bags', hint: 'contents tracked' },
            { value: 'bags', label: 'Bags only', hint: 'barcode + size' },
          ]"
          :key="m.value"
          class="rounded-lg border-2 p-3 text-left transition-colors"
          :class="
            packMode === m.value
              ? 'border-brand-600 bg-brand-50 text-brand-800'
              : 'border-neutral-200 bg-white text-neutral-600'
          "
          :disabled="packages.length > 0"
          @click="switchMode(m.value as 'items' | 'bags')"
        >
          <p class="text-sm font-semibold">{{ m.label }}</p>
          <p class="text-[11px] opacity-70">{{ m.hint }}</p>
        </button>
      </div>
      <p v-if="packages.length > 0" class="-mt-2 text-[11px] text-neutral-400">
        Mode locks once packing starts — remove all packages to switch.
      </p>

      <!-- Add bag -->
      <div class="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <div class="flex gap-2">
          <UInput
            v-model="bagForm.ref"
            placeholder="Bag barcode…"
            class="flex-1 font-mono"
            autocomplete="off"
          />
          <UButton v-if="isNative" variant="soft" :loading="scanBusy" @click="scanBagRef">
            📷
          </UButton>
        </div>

        <!-- Size row: pressable squares, radio semantics -->
        <div>
          <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Size
          </p>
          <div class="flex gap-2">
            <button
              v-for="s in SIZES"
              :key="s"
              class="h-12 flex-1 rounded-lg border-2 font-semibold transition-colors"
              :class="
                bagForm.size === s
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-neutral-200 bg-white text-neutral-600'
              "
              @click="bagForm.size = bagForm.size === s ? null : s"
            >
              {{ s }}
            </button>
          </div>
        </div>

        <!-- Temperature row: pressable squares, radio semantics -->
        <div>
          <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Type
          </p>
          <div class="flex gap-2">
            <button
              v-for="t in TEMPS"
              :key="t.value"
              class="h-12 flex-1 rounded-lg border-2 text-sm font-semibold transition-colors"
              :class="
                bagForm.temperature === t.value
                  ? t.value === 'frozen'
                    ? 'border-cyan-600 bg-cyan-600 text-white'
                    : t.value === 'refrigerated'
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-brand-600 bg-brand-600 text-white'
                  : 'border-neutral-200 bg-white text-neutral-600'
              "
              @click="bagForm.temperature = t.value"
            >
              {{ t.label }}
            </button>
          </div>
        </div>

        <div class="flex gap-2">
          <UButton class="flex-1" :disabled="!bagForm.ref.trim() || !bagForm.size" @click="addBag">
            Add bag
          </UButton>
          <UButton color="neutral" variant="soft" @click="addLoose">+ Loose</UButton>
        </div>
      </div>

      <!-- Packages -->
      <div v-if="packages.length > 0" class="flex flex-col gap-2">
        <p class="text-sm font-semibold">Packages ({{ packages.length }})</p>
        <UCard
          v-for="pkg in packages"
          :key="pkg.ref"
          :class="packMode === 'items' && activeRef === pkg.ref ? 'ring-2 ring-brand-500' : ''"
          @click="activeRef = pkg.ref"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate font-mono text-sm font-semibold">
                {{ pkg.kind === 'loose' ? '📦 Loose' : `🛍 ${pkg.ref}` }}
              </p>
              <p class="text-[11px] text-neutral-500">
                <template v-if="pkg.kind === 'bag'">{{ pkg.size }} · </template>
                {{ TEMPS.find((t) => t.value === pkg.temperature)?.label }}
                <template v-if="packMode === 'items'">
                  · {{ Object.values(pkg.items).reduce((a, b) => a + b, 0) }} item(s)
                </template>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <span
                v-if="packMode === 'items' && activeRef === pkg.ref"
                class="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700"
              >
                PACKING INTO
              </span>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                @click.stop="removePackage(pkg.ref)"
              >
                ✕
              </UButton>
            </div>
          </div>
        </UCard>
      </div>

      <!-- items sub-mode: assign picked units into the active package -->
      <template v-if="packMode === 'items'">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold">Items to pack</p>
          <UButton v-if="isNative" size="xs" variant="soft" :loading="scanBusy" @click="scanItem">
            📷 Scan into bag
          </UButton>
        </div>
        <UCard v-for="line in lines" :key="`pack-${line.externalLineRef}`">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ line.description }}</p>
              <p class="text-[11px] text-neutral-500">
                picked {{ counts[line.externalLineRef] ?? 0 }} · packed
                {{ assignedPerLine[line.externalLineRef] ?? 0 }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <UButton size="lg" color="neutral" variant="soft" @click="assign(line, -1)">
                −
              </UButton>
              <span class="min-w-10 text-center font-mono">
                {{ activePackage?.items[line.externalLineRef] ?? 0 }}
              </span>
              <UButton size="lg" variant="soft" @click="assign(line, 1)">+</UButton>
            </div>
          </div>
        </UCard>
      </template>

      <div class="flex gap-2">
        <UButton color="neutral" variant="soft" @click="stage = 'pick'">← Back to picking</UButton>
        <UButton class="flex-1" size="xl" :loading="busy" :disabled="!canComplete" @click="complete">
          Complete pick
          {{ packMode === 'items' && unassignedTotal > 0 ? `(${unassignedTotal} unpacked)` : '' }}
        </UButton>
      </div>
    </template>

    <!-- Fail (available in both stages) -->
    <div v-if="!failMode" class="text-center">
      <UButton variant="link" color="error" size="sm" @click="failMode = true">
        Can't fulfil — fail this pick
      </UButton>
    </div>
    <div v-else class="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
      <UTextarea v-model="failReason" placeholder="Why can't this pick be fulfilled?" :rows="2" />
      <div class="flex gap-2">
        <UButton
          color="error"
          :loading="busy"
          :disabled="!failReason.trim()"
          class="flex-1"
          @click="fail"
        >
          Fail pick
        </UButton>
        <UButton color="neutral" variant="soft" @click="failMode = false">Cancel</UButton>
      </div>
    </div>
  </div>
</template>
