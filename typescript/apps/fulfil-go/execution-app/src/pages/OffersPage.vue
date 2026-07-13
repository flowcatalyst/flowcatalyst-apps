<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useAppCtx } from '../context.js';

/**
 * The claim marketplace, consumed natively (same surface EPOD's proxy
 * speaks): request an offer → a reserved TRIP (driver + vehicle bound,
 * 30s hold) → claim it before the countdown lapses. Anchor entry lets the
 * driver type the part number off the packaging.
 *
 * Claimed trips come from GET /transport/my-trips — SERVER state, so a
 * claim survives tab switches and app restarts. Per-stop collected/
 * delivered reporting lands with the driver status-report API.
 */
interface OfferStop {
  orderId: string;
  shortId: string;
  destination: {
    name?: string;
    address?: { line1?: string; city?: string };
  };
  legKm: number | null;
  legMinutes: number | null;
}

interface Offer {
  groupId: string;
  partReferences: string[];
  transportOrderRefs: string[];
  expiresAt: string;
  originRef: string;
  stops: OfferStop[];
  routeKm: number | null;
  routeMinutes: number | null;
}

interface MyTrip {
  tripId: string;
  originRef: string;
  claimedAt: string;
  routeKm: number | null;
  routeMinutes: number | null;
  stops: OfferStop[];
}

const ctx = useAppCtx();
const offer = ref<Offer | null>(null);
const myTrips = ref<MyTrip[]>([]);
const emptyReason = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const anchorRef = ref('');
const secondsLeft = ref(0);
let countdown: ReturnType<typeof setInterval> | null = null;

const EMPTY_MESSAGES: Record<string, string> = {
  NO_OFFERABLE_ORDERS: 'No deliveries waiting at your depot right now.',
  ANCHOR_NOT_FOUND: 'No waiting delivery matches that number.',
  ANCHOR_UNAVAILABLE: 'That delivery was just taken by another driver.',
  DEPOT_SERVES_NO_STORES: 'Your depot has no stores linked — ask a manager.',
  NO_STORE_ON_CLAIM_STRATEGY: 'No stores at your depot offer claimable work.',
};
const emptyMessage = computed(() =>
  emptyReason.value ? (EMPTY_MESSAGES[emptyReason.value] ?? 'No work available right now.') : null,
);

async function loadMyTrips(): Promise<void> {
  if (!ctx.driverSignedIn.value) return;
  try {
    const res = await ctx.api.json<{ trips: MyTrip[] }>(
      `/clients/${ctx.station.clientId.value}/transport/my-trips`,
    );
    myTrips.value = res.trips;
  } catch {
    // Offline / stale session — keep whatever we had; next load recovers.
  }
}

function stopCountdown(): void {
  if (countdown) clearInterval(countdown);
  countdown = null;
}

function startCountdown(expiresAt: string): void {
  stopCountdown();
  const tick = () => {
    secondsLeft.value = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000));
    if (secondsLeft.value === 0) {
      // Hold lapsed — the reservation frees itself server-side.
      offer.value = null;
      stopCountdown();
    }
  };
  tick();
  countdown = setInterval(tick, 500);
}

async function findWork(): Promise<void> {
  busy.value = true;
  error.value = null;
  emptyReason.value = null;
  try {
    const res = await ctx.api.json<{ offers: Offer[]; reason?: string }>(
      `/clients/${ctx.station.clientId.value}/transport/offers`,
      {
        method: 'POST',
        body: anchorRef.value.trim() ? { orderReference: anchorRef.value.trim() } : {},
      },
    );
    if (res.offers.length === 0) {
      emptyReason.value = res.reason ?? 'NO_OFFERABLE_ORDERS';
      offer.value = null;
      return;
    }
    offer.value = res.offers[0]!;
    startCountdown(offer.value.expiresAt);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function claim(): Promise<void> {
  if (!offer.value) return;
  busy.value = true;
  error.value = null;
  try {
    await ctx.api.json(
      `/clients/${ctx.station.clientId.value}/transport/offers/${offer.value.groupId}/claim`,
      { method: 'POST' },
    );
    offer.value = null;
    stopCountdown();
    await loadMyTrips();
  } catch (err) {
    // 410 = the hold lapsed or someone raced us — just look again.
    offer.value = null;
    stopCountdown();
    error.value = 'That offer expired — find work again.';
    void err;
  } finally {
    busy.value = false;
  }
}

function passOffer(): void {
  // Walking away is fine — the hold lapses on its own (EPOD semantics).
  offer.value = null;
  stopCountdown();
}

onMounted(() => void loadMyTrips());
watch(ctx.driverSignedIn, () => void loadMyTrips());
onUnmounted(stopCountdown);
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <template v-if="!ctx.driverSignedIn.value">
      <UAlert
        description="Sign in with your staff code + PIN to see claimable work."
        color="info"
        variant="soft"
      />
      <UButton to="/driver-login" block size="lg">Driver sign in</UButton>
    </template>

    <template v-else>
      <div class="rounded-xl border border-neutral-200 bg-white p-4">
        <p class="text-sm font-semibold text-neutral-800">
          {{ ctx.driver.value?.displayName ?? 'Driver' }}
        </p>
        <p class="text-xs text-neutral-500">
          Depot <span class="font-mono">{{ ctx.driver.value?.depotRef }}</span>
          <template v-if="ctx.driver.value?.defaultVehicleReg">
            · <span class="font-mono">{{ ctx.driver.value.defaultVehicleReg }}</span>
          </template>
          <template v-if="ctx.driver.value?.defaultVehicleClass">
            ({{ ctx.driver.value.defaultVehicleClass }})
          </template>
        </p>
      </div>

      <!-- Find work (optionally anchored on a typed part number) -->
      <div v-if="!offer" class="flex flex-col gap-2">
        <UInput
          v-model="anchorRef"
          placeholder="Part number (optional — e.g. 1024)"
          inputmode="numeric"
          class="w-full"
        />
        <UButton block size="lg" :loading="busy" @click="findWork">Find work</UButton>
        <UAlert v-if="emptyMessage" :description="emptyMessage" color="neutral" variant="soft" />
      </div>

      <!-- The reserved offer, on a countdown -->
      <div v-if="offer" class="rounded-xl border-2 border-brand-400 bg-white p-4">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-sm font-semibold text-neutral-800">
            {{ offer.stops.length }} stop trip from
            <span class="font-mono">{{ offer.originRef }}</span>
          </p>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-bold"
            :class="secondsLeft > 10 ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'"
          >
            {{ secondsLeft }}s
          </span>
        </div>
        <ol class="mb-3 flex flex-col gap-1.5">
          <li v-for="(s, i) in offer.stops" :key="s.orderId" class="flex items-baseline gap-2">
            <span class="text-xs font-bold text-neutral-400">{{ i + 1 }}</span>
            <span class="text-sm">
              <span class="font-semibold">#{{ s.shortId }}</span>
              {{ s.destination.name }}
              <span class="text-xs text-neutral-500">
                {{ s.destination.address?.line1 }}
                <template v-if="s.legKm !== null"> · {{ s.legKm.toFixed(1) }} km</template>
              </span>
            </span>
          </li>
        </ol>
        <p v-if="offer.routeKm !== null" class="mb-3 text-xs text-neutral-500">
          Route ≈ {{ offer.routeKm.toFixed(1) }} km · {{ Math.round(offer.routeMinutes ?? 0) }} min
        </p>
        <div class="flex gap-2">
          <UButton block size="lg" :loading="busy" :disabled="secondsLeft === 0" @click="claim">
            Claim trip
          </UButton>
          <UButton color="neutral" variant="soft" size="lg" @click="passOffer">Pass</UButton>
        </div>
      </div>

      <!-- My trips — SERVER state, survives restarts (claims live here) -->
      <section v-if="myTrips.length > 0" class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold text-neutral-700">My trips</h2>
        <div
          v-for="t in myTrips"
          :key="t.tripId"
          class="rounded-xl border border-emerald-300 bg-emerald-50 p-4"
        >
          <p class="mb-1 text-sm font-semibold text-emerald-800">
            Collect at <span class="font-mono">{{ t.originRef }}</span>
            <span v-if="t.routeKm !== null" class="font-normal text-emerald-700">
              · ≈{{ t.routeKm.toFixed(1) }} km
            </span>
          </p>
          <ol class="mb-2 flex flex-col gap-1">
            <li v-for="(s, i) in t.stops" :key="s.orderId" class="text-sm text-emerald-900">
              {{ i + 1 }}. <span class="font-semibold">#{{ s.shortId }}</span>
              {{ s.destination.name }} — {{ s.destination.address?.line1 }}
            </li>
          </ol>
          <p class="text-xs text-emerald-700">
            Scan the bag labels at collection. Delivery reporting arrives in the next app update.
          </p>
        </div>
      </section>

      <UAlert v-if="error" :description="error" color="error" variant="soft" />
    </template>
  </div>
</template>
