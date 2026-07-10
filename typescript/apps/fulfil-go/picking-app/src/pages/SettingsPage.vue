<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { QueueItem } from '@fulfil-go/mobile-kit';
import { useAppCtx } from '../context.js';

const ctx = useAppCtx();
const router = useRouter();
const dead = ref<readonly QueueItem[]>([]);

async function refreshDead(): Promise<void> {
  dead.value = await ctx.queue.listDead();
}
onMounted(() => {
  void refreshDead();
  ctx.queue.onChange(() => void refreshDead());
});

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

    <section v-if="dead.length > 0" class="flex flex-col gap-2">
      <h2 class="font-semibold">Failed submissions</h2>
      <UCard v-for="item in dead" :key="item.id">
        <div class="flex items-center justify-between gap-2 text-sm">
          <div class="min-w-0">
            <p class="truncate font-mono">{{ item.method }} {{ item.endpoint }}</p>
            <p class="truncate text-xs text-neutral-500">{{ item.lastError }}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <UButton size="xs" variant="soft" @click="ctx.queue.retryDead(item.id)">Retry</UButton>
            <UButton size="xs" color="error" variant="soft" @click="ctx.queue.discardDead(item.id)">
              Discard
            </UButton>
          </div>
        </div>
      </UCard>
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
