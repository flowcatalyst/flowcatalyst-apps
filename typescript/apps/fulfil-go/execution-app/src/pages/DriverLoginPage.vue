<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { driverPinLogin, PickerLoginError } from '@fulfil-go/mobile-kit';
import { useAppCtx } from '../context.js';

/**
 * Driver shift sign-in — staff code + PIN at the device's bound depot (the
 * picking app's pattern; decided Andrew 2026-07-13). The depot binding
 * itself lives on the Settings page.
 */
const ctx = useAppCtx();
const router = useRouter();
const form = reactive({ staffCode: '', pin: '' });
const busy = ref(false);
const error = ref<string | null>(null);

async function signIn(): Promise<void> {
  if (!form.staffCode || !form.pin) return;
  busy.value = true;
  error.value = null;
  try {
    const tokens = await driverPinLogin(ctx.api.baseUrl, {
      clientId: ctx.station.clientId.value,
      depotRef: ctx.station.depotRef.value,
      staffCode: form.staffCode.trim(),
      pin: form.pin,
    });
    await ctx.driverSession.setSession(tokens);
    await ctx.startDriverShift();
    form.staffCode = '';
    form.pin = '';
    await router.push('/offers');
  } catch (err) {
    error.value =
      err instanceof PickerLoginError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-4 p-6">
    <div
      class="mb-1 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-300 shadow-lg shadow-brand-500/25"
    >
      <UIcon name="i-lucide-truck" class="size-7 text-white" />
    </div>
    <div class="text-center">
      <h1 class="text-2xl font-semibold text-neutral-900">FulfilGo Drive</h1>
      <p class="mt-1 text-sm text-neutral-500">
        Depot <span class="font-mono">{{ ctx.station.depotRef.value || 'not set' }}</span>
      </p>
    </div>

    <form
      v-if="ctx.station.configured()"
      class="flex w-full max-w-xs flex-col gap-3"
      @submit.prevent="signIn"
    >
      <UFormField label="Staff code">
        <UInput
          v-model="form.staffCode"
          placeholder="D01"
          autocapitalize="characters"
          autocomplete="off"
          class="w-full"
          size="xl"
        />
      </UFormField>
      <UFormField label="PIN">
        <UInput
          v-model="form.pin"
          type="password"
          inputmode="numeric"
          placeholder="••••••"
          autocomplete="off"
          class="w-full"
          size="xl"
        />
      </UFormField>
      <UButton
        type="submit"
        size="xl"
        block
        :loading="busy"
        :disabled="!form.staffCode || !form.pin"
      >
        Sign in
      </UButton>
    </form>
    <UAlert
      v-else
      description="This device is not bound to a depot yet — set the client + depot in Settings."
      color="warning"
      variant="soft"
      class="max-w-xs"
    />

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="max-w-xs" />

    <UButton variant="link" color="neutral" size="xs" to="/settings">Configure device</UButton>
  </div>
</template>
