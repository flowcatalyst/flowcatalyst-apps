<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAppCtx } from '../context.js';

const ctx = useAppCtx();
const router = useRouter();

async function exit(): Promise<void> {
  await ctx.exit();
  await router.push('/login');
}
</script>

<template>
  <div class="flex flex-col gap-6 p-4">
    <section class="flex flex-col gap-3">
      <h2 class="font-semibold">Station</h2>
      <p class="text-xs text-neutral-500">
        This station is bound to one store — set once by an admin. (Manual stand-in for device
        enrollment; see pick-context-auth.md.)
      </p>
      <UFormField label="Client id">
        <UInput v-model="ctx.station.clientId.value" placeholder="clt_…" class="w-full font-mono" />
      </UFormField>
      <UFormField label="Store ref">
        <UInput
          v-model="ctx.station.storeRef.value"
          placeholder="store-001"
          class="w-full font-mono"
        />
      </UFormField>
    </section>

    <section v-if="ctx.signedIn.value" class="flex flex-col gap-2">
      <h2 class="font-semibold">Session</h2>
      <p class="text-xs text-neutral-500">
        Signed in as <span class="font-mono">{{ ctx.pickerId.value }}</span>
      </p>
      <UButton color="neutral" variant="soft" block @click="exit">Exit — end my session</UButton>
    </section>
    <UButton v-else variant="soft" block to="/login">Go to sign in</UButton>
  </div>
</template>
