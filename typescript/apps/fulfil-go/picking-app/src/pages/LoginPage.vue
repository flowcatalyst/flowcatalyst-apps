<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { pickerPinLogin, PickerLoginError } from '@fulfil-go/mobile-kit';
import { useAppCtx } from '../context.js';

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
    const tokens = await pickerPinLogin(ctx.api.baseUrl, {
      clientId: ctx.station.clientId.value,
      storeRef: ctx.station.storeRef.value,
      staffCode: form.staffCode.trim(),
      pin: form.pin,
    });
    await ctx.session.setSession(tokens);
    await ctx.startShift();
    form.staffCode = '';
    form.pin = '';
    await router.push('/picks');
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
      <UIcon name="i-lucide-zap" class="size-7 text-white" />
    </div>
    <div class="text-center">
      <h1 class="text-2xl font-semibold text-neutral-900">FulfilGo Pick</h1>
      <p class="mt-1 text-sm text-neutral-500">
        Station <span class="font-mono">{{ ctx.station.storeRef.value }}</span>
      </p>
    </div>

    <form class="flex w-full max-w-xs flex-col gap-3" @submit.prevent="signIn">
      <UFormField label="Staff code">
        <UInput
          v-model="form.staffCode"
          placeholder="P01"
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

    <UAlert v-if="error" :description="error" color="error" variant="soft" class="max-w-xs" />

    <UButton variant="link" color="neutral" size="xs" to="/settings">Configure station</UButton>
  </div>
</template>
