<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PickDto } from '@fulfil-go/shared';
import { useAppCtx } from '../context.js';

// Live-updated over the store SSE channel (hydrate happens on login and on
// every stream open) — the Refresh button is just a manual reconcile.
const ctx = useAppCtx();
const expanded = ref<string | null>(null);
/** Handover section (bottom of page) — collapsed until store staff need a PIN. */
const handoverOpen = ref(false);
const claiming = ref<string | null>(null);

const available = computed(() => ctx.picks.available.value);
const mine = computed(() => ctx.picks.mine.value);
const awaitingHandover = computed(() => ctx.picks.awaitingHandover.value);

// Pickup-PIN reveal (docs/handover-verification.md): store staff read the
// pin out to a driver whose scan failed. EVERY reveal is AUDITED server-side
// (pin-viewed activity entry) — shown on demand, never in the list payload.
const pinFor = ref<Record<string, string>>({});
const pinBusy = ref<string | null>(null);
const pinError = ref<string | null>(null);

async function revealPin(pick: PickDto): Promise<void> {
  if (pinFor.value[pick.id]) {
    const { [pick.id]: _hide, ...rest } = pinFor.value;
    pinFor.value = rest;
    return;
  }
  pinBusy.value = pick.id;
  pinError.value = null;
  try {
    const res = await ctx.api.json<{
      pickupPins: { partId: string; pin: string }[];
    }>(`/clients/${ctx.station.clientId.value}/fulfilments/${pick.fulfilmentId}/handover-pins`);
    const pin = res.pickupPins.find((p) => p.partId === pick.partId)?.pin;
    if (!pin) {
      pinError.value = `No pickup PIN on record for #${pick.shortId} (created before PINs or policy off).`;
      return;
    }
    pinFor.value = { ...pinFor.value, [pick.id]: pin };
  } catch (err) {
    pinError.value = err instanceof Error ? err.message : String(err);
  } finally {
    pinBusy.value = null;
  }
}

function toggle(id: string): void {
  expanded.value = expanded.value === id ? null : id;
}

async function claim(pick: PickDto): Promise<void> {
  claiming.value = pick.id;
  try {
    await ctx.picks.claim(pick.id);
  } finally {
    claiming.value = null;
  }
}

function slot(pick: PickDto): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(pick.slotStart)}–${fmt(pick.slotEnd)}`;
}

function units(pick: PickDto): number {
  return pick.lines.reduce((sum, line) => sum + ((line as { quantity?: number }).quantity ?? 0), 0);
}

// SUPERVISOR MODE (Andrew, 2026-07-14): flag a pick as needing a CAR OR
// BIGGER — no bike/scooter. Toggle visible only on supervisor sessions;
// the 🚗 badge shows for everyone. A supervisor 'yes' survives the picker's
// completion answer, and post-completion flags re-stamp the part while
// transport hasn't been requested.
const flagBusy = ref<string | null>(null);

async function toggleCarFlag(pick: PickDto): Promise<void> {
  flagBusy.value = pick.id;
  pinError.value = null;
  try {
    await ctx.api.json(`/clients/${ctx.station.clientId.value}/picks/${pick.id}/car-flag`, {
      method: 'POST',
      body: { requiresCarOrLarger: pick.requiresCarOrLarger !== true },
    });
    // The pick.updated SSE event reconciles; hydrate covers a missed push.
    await ctx.picks.hydrate();
  } catch (err) {
    pinError.value = err instanceof Error ? err.message : String(err);
  } finally {
    flagBusy.value = null;
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <div class="flex items-center justify-between">
      <h2 class="font-semibold">Available ({{ available.length }})</h2>
      <UButton
        size="xs"
        variant="soft"
        :loading="ctx.picks.loading.value"
        @click="ctx.picks.hydrate()"
      >
        Refresh
      </UButton>
    </div>
    <UAlert
      v-if="ctx.picks.error.value"
      :description="ctx.picks.error.value"
      color="error"
      variant="soft"
    />

    <p v-if="available.length === 0" class="text-sm text-neutral-500">
      No picks waiting for this store.
    </p>
    <UCard v-for="pick in available" :key="pick.id" @click="toggle(pick.id)">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="font-mono text-lg font-semibold">#{{ pick.shortId }}</p>
          <p class="text-xs text-neutral-500">
            {{ pick.lines.length }} line(s) · {{ units(pick) }} units · slot {{ slot(pick) }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span
            v-if="pick.serviceLevel === 'ASAP'"
            class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
          >
            ASAP
          </span>
          <span
            v-if="pick.requiresCarOrLarger === true"
            class="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700"
            title="Needs a car or bigger — no bike/scooter"
          >
            🚗 CAR+
          </span>
          <UButton
            v-if="ctx.supervisor.value"
            size="xs"
            :color="pick.requiresCarOrLarger === true ? 'warning' : 'neutral'"
            variant="soft"
            :loading="flagBusy === pick.id"
            :title="
              pick.requiresCarOrLarger === true
                ? 'Clear the car-or-bigger flag'
                : 'Flag: needs a car or bigger (no bike/scooter)'
            "
            @click.stop="toggleCarFlag(pick)"
          >
            🚗
          </UButton>
          <UButton size="lg" :loading="claiming === pick.id" @click.stop="claim(pick)">
            Claim
          </UButton>
        </div>
      </div>
      <ul v-if="expanded === pick.id" class="mt-3 divide-y divide-neutral-100 text-sm">
        <li
          v-for="(line, i) in pick.lines"
          :key="i"
          class="flex items-center justify-between gap-2 py-1.5"
        >
          <span class="truncate">
            <span class="font-medium">{{ line.quantity }}×</span> {{ line.description }}
          </span>
          <span
            v-if="line.temperatureClass && line.temperatureClass !== 'ambient'"
            class="shrink-0 text-xs text-cyan-600"
          >
            {{ line.temperatureClass }}
          </span>
        </li>
      </ul>
    </UCard>


    <h2 class="mt-2 font-semibold">Mine ({{ mine.length }})</h2>
    <p v-if="mine.length === 0" class="text-sm text-neutral-500">Nothing claimed yet.</p>
    <!-- Tap opens the picking workflow (count/scan → complete or fail). -->
    <UCard
      v-for="pick in mine"
      :key="pick.id"
      class="cursor-pointer"
      @click="$router.push(`/picks/${pick.id}`)"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="font-mono text-lg font-semibold">#{{ pick.shortId }}</p>
          <p class="text-xs text-neutral-500">
            {{ pick.lines.length }} line(s) · {{ units(pick) }} units · slot {{ slot(pick) }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span
            v-if="pick.requireFullPick"
            class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
          >
            FULL
          </span>
          <span
            v-if="pick.requiresCarOrLarger === true"
            class="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700"
            title="Needs a car or bigger — no bike/scooter"
          >
            🚗 CAR+
          </span>
          <UButton size="lg" variant="soft">Pick →</UButton>
        </div>
      </div>
    </UCard>
    <!-- Awaiting driver handover: the store side of collection. The PIN is
         the override for a failed scan — each reveal is audited. Lives at
         the bottom, collapsed — it's a lookup surface, not the work queue. -->
    <template v-if="awaitingHandover.length > 0">
      <button
        type="button"
        class="mt-2 flex w-full items-center justify-between text-left"
        @click="handoverOpen = !handoverOpen"
      >
        <h2 class="font-semibold">Handover ({{ awaitingHandover.length }})</h2>
        <UIcon
          :name="handoverOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="size-5 text-neutral-400"
        />
      </button>
      <template v-if="handoverOpen">
      <UAlert v-if="pinError" :description="pinError" color="warning" variant="soft" />
      <UCard v-for="pick in awaitingHandover" :key="`ho-${pick.id}`" :ui="{ body: 'p-3' }">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="font-mono text-lg font-semibold">#{{ pick.shortId }}</p>
            <p class="text-xs text-neutral-500">
              {{ pick.packages?.length ?? 0 }} package(s) ·
              {{ pick.status === 'short_picked' ? 'short picked' : 'picked' }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span
              v-if="pick.requiresCarOrLarger === true"
              class="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700"
              title="Needs a car or bigger — no bike/scooter"
            >
              🚗 CAR+
            </span>
            <UButton
              v-if="ctx.supervisor.value"
              size="xs"
              :color="pick.requiresCarOrLarger === true ? 'warning' : 'neutral'"
              variant="soft"
              :loading="flagBusy === pick.id"
              @click="toggleCarFlag(pick)"
            >
              🚗
            </UButton>
            <span
              v-if="pinFor[pick.id]"
              class="rounded-lg bg-brand-50 px-3 py-1 font-mono text-xl font-bold tracking-widest text-brand-700"
            >
              {{ pinFor[pick.id] }}
            </span>
            <UButton
              size="sm"
              variant="soft"
              :loading="pinBusy === pick.id"
              @click="revealPin(pick)"
            >
              {{ pinFor[pick.id] ? 'Hide' : 'Pickup PIN' }}
            </UButton>
          </div>
        </div>
      </UCard>
      </template>
    </template>
  </div>
</template>
