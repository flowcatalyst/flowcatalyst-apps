<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { QueueItem } from '@fulfil-go/mobile-kit';
import { useAppCtx } from '../context.js';

const ctx = useAppCtx();
const router = useRouter();

async function exitDriver(): Promise<void> {
  await ctx.exitDriver();
  await router.push('/driver-login');
}
const tracking = ref(false);
const telemetryError = ref<string | null>(null);
const dead = ref<readonly QueueItem[]>([]);

async function refreshDead(): Promise<void> {
  dead.value = await ctx.queue.listDead();
}

onMounted(() => {
  void refreshDead();
  ctx.queue.onChange(() => void refreshDead());
  if (ctx.isNative) {
    void loadTelemetryState();
  }
});

/**
 * Telemetry is native-only and loaded via the subpath export so the
 * Transistorsoft plugin never enters the web bundle path at startup.
 */
async function telemetry() {
  const { createTelemetry } = await import('@fulfil-go/mobile-kit/telemetry');
  return createTelemetry();
}

async function loadTelemetryState(): Promise<void> {
  try {
    tracking.value = await (await telemetry()).isTracking();
  } catch {
    // Plugin not ready yet (first run before configure) — leave toggle off.
  }
}

async function toggleTracking(value: boolean): Promise<void> {
  telemetryError.value = null;
  try {
    const t = await telemetry();
    if (value) {
      const tokens = await ctx.session.getAccessToken();
      const refreshToken = await ctx.session.getRefreshToken();
      if (!tokens || !refreshToken) throw new Error('sign in before starting telemetry');
      const baseUrl = ctx.api.baseUrl;
      await t.configure({
        app: 'execution',
        url: `${baseUrl}/telemetry/locations`,
        refreshUrl: `${baseUrl}/auth/mobile/refresh`,
        accessToken: tokens,
        refreshToken,
        expiresAt: Date.now() + 300_000,
      });
      await t.start();
    } else {
      await t.stop();
    }
    tracking.value = value;
  } catch (err) {
    telemetryError.value = err instanceof Error ? err.message : String(err);
    tracking.value = !value;
  }
}

async function logout(): Promise<void> {
  await ctx.auth.logout();
  window.location.href = '/login';
}
</script>

<template>
  <div class="flex flex-col gap-6 p-4">
    <!-- Device → depot binding (the picking app's station pattern): an admin
         binds the device once; drivers sign in per shift with code + PIN. -->
    <section class="flex flex-col gap-2">
      <h2 class="font-semibold">Driver station</h2>
      <p class="text-xs text-neutral-500">
        Bind this device to a client + home depot (from Transport → Depots in management). Drivers
        then sign in with their staff code + PIN.
      </p>
      <UFormField label="Client id">
        <UInput
          v-model="ctx.station.clientId.value"
          placeholder="clt_…"
          class="w-full font-mono"
          :disabled="ctx.driverSignedIn.value"
        />
      </UFormField>
      <UFormField label="Depot ref">
        <UInput
          v-model="ctx.station.depotRef.value"
          placeholder="dep-bloemfontein"
          class="w-full font-mono"
          :disabled="ctx.driverSignedIn.value"
        />
      </UFormField>
      <template v-if="ctx.driverSignedIn.value">
        <p class="text-sm">
          Signed in:
          <span class="font-medium">{{ ctx.driver.value?.displayName }}</span>
          <span
            v-if="ctx.driver.value?.defaultVehicleReg"
            class="font-mono text-xs text-neutral-500"
          >
            · {{ ctx.driver.value.defaultVehicleReg }}
          </span>
        </p>
        <UButton color="neutral" variant="soft" block @click="exitDriver">
          End shift (sign out driver)
        </UButton>
      </template>
      <UButton v-else variant="soft" block to="/driver-login" :disabled="!ctx.station.configured()">
        Driver sign in
      </UButton>
    </section>

    <section v-if="ctx.isNative" class="flex flex-col gap-2">
      <h2 class="font-semibold">Telemetry</h2>
      <div class="flex items-center justify-between">
        <span class="text-sm">Share location while on duty</span>
        <USwitch :model-value="tracking" @update:model-value="toggleTracking" />
      </div>
      <UAlert v-if="telemetryError" :description="telemetryError" color="error" variant="soft" />
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="font-semibold">Failed changes</h2>
      <p v-if="dead.length === 0" class="text-sm text-neutral-500">Nothing needs attention.</p>
      <UCard v-for="item in dead" :key="item.id">
        <div class="flex items-center justify-between gap-2 text-sm">
          <div class="min-w-0">
            <p class="truncate font-mono">{{ item.method }} {{ item.endpoint }}</p>
            <p class="truncate text-xs text-neutral-500">{{ item.lastError }}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <UButton size="xs" variant="soft" @click="ctx.queue.retryDead(item.id)">
              Retry
            </UButton>
            <UButton size="xs" color="error" variant="soft" @click="ctx.queue.discardDead(item.id)">
              Discard
            </UButton>
          </div>
        </div>
      </UCard>
    </section>

    <UButton v-if="ctx.isNative" color="neutral" variant="soft" block @click="logout">
      Sign out
    </UButton>
  </div>
</template>
