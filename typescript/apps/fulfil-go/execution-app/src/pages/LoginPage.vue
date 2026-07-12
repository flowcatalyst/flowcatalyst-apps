<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppCtx } from '../context.js';

const ctx = useAppCtx();
const router = useRouter();
const busy = ref(false);
const error = ref<string | null>(null);

async function signIn(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await ctx.auth.login();
    await ctx.startSync();
    await router.push('/jobs');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
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
    <h1 class="text-2xl font-semibold text-neutral-900">FulfilGo Drive</h1>
    <template v-if="ctx.isNative">
      <UButton size="xl" :loading="busy" @click="signIn">Sign in</UButton>
      <UAlert v-if="error" :description="error" color="error" variant="soft" />
    </template>
    <UAlert
      v-else
      title="Browser dev mode"
      description="Authenticated via the server's x-user-id dev fallback — no sign-in needed."
      variant="soft"
    />
  </div>
</template>
