<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { completeSignIn } from '../auth/session.js';

/**
 * PKCE redirect landing (/login/callback — NOT under /auth, which the dev
 * proxy forwards to the server): exchanges the code for tokens and returns
 * to where the sign-in started.
 */
const route = useRoute();
const router = useRouter();
const error = ref<string | null>(null);

onMounted(async () => {
  const code = typeof route.query['code'] === 'string' ? route.query['code'] : null;
  const state = typeof route.query['state'] === 'string' ? route.query['state'] : null;
  if (!code || !state) {
    error.value = 'Missing code/state on the callback — start the sign-in again.';
    return;
  }
  try {
    const returnTo = await completeSignIn(code, state);
    // Full reload so every mounted view refetches under the new identity.
    window.location.replace(returnTo);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Sign-in failed.';
  }
});

function goHome(): void {
  void router.replace('/');
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-neutral-50">
    <div class="w-96 rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
      <template v-if="error">
        <UIcon name="i-lucide-shield-x" class="mx-auto size-8 text-red-500" />
        <p class="mt-3 text-sm font-medium text-neutral-800">Sign-in failed</p>
        <p class="mt-1 text-xs text-neutral-500">{{ error }}</p>
        <UButton class="mt-4" variant="soft" @click="goHome">Back to the app</UButton>
      </template>
      <template v-else>
        <UIcon name="i-lucide-loader-circle" class="mx-auto size-8 animate-spin text-brand-500" />
        <p class="mt-3 text-sm text-neutral-600">Completing sign-in…</p>
      </template>
    </div>
  </div>
</template>
