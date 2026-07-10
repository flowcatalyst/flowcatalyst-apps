<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PickDto } from '@fulfil-go/shared';
import { useAppCtx } from '../context.js';

// Live-updated over the store SSE channel (hydrate happens on login and on
// every stream open) — the Refresh button is just a manual reconcile.
const ctx = useAppCtx();
const expanded = ref<string | null>(null);
const claiming = ref<string | null>(null);

const available = computed(() => ctx.picks.available.value);
const mine = computed(() => ctx.picks.mine.value);

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
  return pick.lines.reduce(
    (sum, line) => sum + ((line as { quantity?: number }).quantity ?? 0),
    0,
  );
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
            v-if="line.temperatureClass && line.temperatureClass !== 'normal'"
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
          <UButton size="lg" variant="soft">Pick →</UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
